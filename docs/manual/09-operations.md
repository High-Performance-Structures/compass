# 9. Operations

## 9.1 Deploy pipeline

![Deploy pipeline](diagrams/deploy-pipeline.png)

**Checks on every pull request** (`.github/workflows/`):

| Workflow | Job | What it runs |
|---|---|---|
| `ci.yml` | Help content | `bun run help:check`: generated help is current and guides were reviewed within 180 days |
| | Lint | `bun run lint` (ESLint) |
| | Dead code | `bun run knip`: unused files and exports |
| | UI standards | `bun run ui:check` (`scripts/check-ui-standards.mjs`) |
| | Build | `bun run build` |
| `test.yml` | Unit tests | `bun run test` and `bun run test:integration` (Vitest; includes the architecture, schema-integrity, polling and email-workflow ratchets of chapter 4) |
| | E2E web | Playwright on Chromium, Firefox and WebKit against a seeded local database (`bun run test:e2e:prepare`) |
| | E2E desktop | Electron smoke on Linux for PRs; the full Linux/macOS/Windows matrix on PRs and `main` |
| | Coverage | `vitest --coverage`, uploaded and non-blocking |

A husky pre-commit hook runs `bun lint`.

**Deploying.** Deployment is a deliberate manual step, not a workflow:

```bash
bun install --frozen-lockfile
bun run deploy        # OpenNext build with a fresh NEXT_DEPLOYMENT_ID, then wrangler deploy
```

`scripts/run-with-deployment-id.mjs` stamps every build with a unique deployment id. Next.js uses it to detect browser tabs still running an older bundle, and `/api/deployment-version` lets the client prompt a reload. To deploy the demo environment:

```bash
bun scripts/run-with-deployment-id.mjs opennextjs-cloudflare build
bunx opennextjs-cloudflare deploy --env demo
```

**Rollback.** `wrangler rollback` returns to the previous worker version. A database change cannot be rolled back this way. Migrations are additive (section 9.2), so the previous code keeps working against the newer schema.

## 9.2 Migrations

The rules are in chapter 5 (section 5.3). The procedure:

1. Write the migration as `drizzle/NNNN_description.sql`. It must be additive: `CREATE TABLE`, `ALTER TABLE … ADD COLUMN`, `CREATE INDEX IF NOT EXISTS`, views and validation triggers. Declare the same objects in `src/db/schema*.ts`. CI replays every migration and compares the result with the schema files.
2. Never edit an applied migration. Data changes (deduplication, backfills) go in a separate, approved PR.
3. After merge, work from a checkout of the merged `main` (the PR's main-based worktree), never from an older local branch:
   ```bash
   bunx wrangler d1 migrations list compass-db --remote     # confirm exactly the expected pending files
   bunx wrangler d1 execute compass-db --remote --command "PRAGMA table_info(<table>)"   # live schema before any ALTER
   bun run db:migrate:prod                                   # wrangler d1 migrations apply compass-db --remote
   ```
4. **Watch for drift.** Production may already have columns that came from migrations on unmerged branches. Read the live schema before any `ALTER`, and use `IF NOT EXISTS` wherever SQLite allows it.
5. Apply the same migrations to the demo database: `bunx wrangler d1 migrations apply compass-demo-db --env demo --remote`.
6. To apply migrations locally: `bun run db:migrate:local`, or `bun run db:init-local` for a fresh local database.

## 9.3 Scheduled jobs: are they still writing?

A failing job logs only `[scheduled] <job> failed: <ErrorClass> status <code>` (section 3.5). Run `wrangler tail compass --format pretty`, filter for `[scheduled]`, and confirm each job's own table is advancing:

| Job | Check (read-only SQL against D1) |
|---|---|
| Accounting bridge health | `SELECT id, last_seen_at FROM sage_bridge_status` (each agent should be within 5 minutes) |
| Inbound email sync | `SELECT mailbox, next_allowed_at, lease_expires_at FROM email_mailbox_state`; `SELECT MAX(imported_at) FROM inbound_emails` |
| Card-payment receipts | `SELECT status, COUNT(*) FROM sage_square_payment_operations GROUP BY status` (nothing stuck in `running`) |
| Paper trail | `SELECT status, COUNT(*), MIN(due_at) FROM project_record_drive_files GROUP BY status` (`pending` items should not be overdue by much more than the quiet period) |
| Personal / project calendars | `SELECT status, MAX(last_synced_at) FROM my_compass_calendars GROUP BY status` (and the same for `compass_project_calendars`) |
| Weather and fire | `SELECT kind, MAX(fetched_at), MAX(failure_count) FROM weather_area_snapshots GROUP BY kind` |
| Missing daily-log reminders | `SELECT reminder_date, COUNT(*) FROM daily_log_reminders GROUP BY reminder_date ORDER BY reminder_date DESC LIMIT 7` |
| Meeting transcripts | `SELECT transcript_status, COUNT(*) FROM project_client_meetings GROUP BY transcript_status` |
| Today's plan | `SELECT MAX(last_digest_on) FROM morning_plan_preferences` |
| Message desk / SMS | `SELECT MAX(stale_reminded_at) FROM staff_message_records`; `SELECT status, MAX(received_at) FROM goto_inbound_events GROUP BY status` |
| Feedback desk | `SELECT operation, status, MAX(completed_at) FROM feedback_maintenance_runs GROUP BY operation, status` |

Run each check with `bunx wrangler d1 execute compass-db --remote --command "<sql>"`. Keep these queries narrow and indexed: one cheap query per check (section 10.1).

## 9.4 Monitoring

- **Logs.** `observability.enabled` is on in `wrangler.jsonc`. Use `bunx wrangler tail compass` for live logs, or the Workers dashboard for history and invocation metrics.
- **Database.** `bunx wrangler d1 insights compass-db --sort-by time --sort-type sum --timePeriod 7d` ranks queries by total time, rows read and count. This is how the hotspots in chapter 10 were found. Re-run it after every performance change.
- **In-app signals.** These reach the people who can act on them:
  - accounting-bridge offline notifications to admins;
  - payment-credential health alerts;
  - stuck-receipt and needs-review notifications;
  - inbound-email and SMS review queues;
  - the feedback desk's service-health table (`feedback_service_health`).
- **Bridge host.** `journalctl --user -u compass-sage-pay-application-poller` (and the other units). On the Windows PC, check the agent's log file and its Task Scheduler history.

## 9.5 Backups and recovery

- **D1.** Cloudflare D1 Time Travel keeps point-in-time restore for the retention window of the plan. Use `bunx wrangler d1 time-travel info compass-db` to find a bookmark, and `bunx wrangler d1 time-travel restore compass-db --bookmark=<id>` to restore it. A restore replaces the whole database, so first restore into a copy if you only need to recover some rows. Take a portable export before any risky operation: `bunx wrangler d1 export compass-db --remote --output=backup.sql`.
- **Files.** Files live in the company's shared drive, which has its own retention and versioning. The paper trail gives each key record a PDF copy beside its files.
- **Accounting** remains the system of record for ledgers and is backed up on its own schedule.
- **Never rebuild tables on D1.** Dropping and recreating a parent table wipes its children or leaves foreign keys off (chapter 5).

## 9.6 Daily regression smoke

`.github/workflows/daily-regression.yml` runs at 13:15 UTC every day and on demand:

- **Production smoke.** Read-only Playwright journeys (`e2e/web`) at desktop Chromium, Android Chrome and iPhone Safari sizes, signed in with a dedicated read-only account (`PLAYWRIGHT_SMOKE_EMAIL`, `PLAYWRIGHT_SMOKE_PASSWORD`).
  - The smoke user belongs to the demo company, so it reads only fictional data.
  - Tests that need fixtures skip in production (`PLAYWRIGHT_REQUIRE_PROJECT: "false"`).
  - Retries absorb short production slowdowns.
- **Android.** `mobile:build`, `cap sync android`, then Gradle unit tests, lint and a debug build.
- **iOS.** `mobile:build`, `cap sync ios`, then an unsigned simulator build.
- **Report.** The workflow opens, updates or closes one rolling issue titled "Daily regression checks are failing".

More detail is in `docs/development/regression-testing.md`.

## 9.7 Mobile and desktop releases

**Mobile.** Most changes do not need a store release: the bundled shell calls the live APIs, and the live wrapper loads the live site. A store build is needed when:

- a Capacitor plugin is added or removed;
- `capacitor.config.ts` changes;
- the bundled field shell (`mobile-shell-src/`) changes;
- icons or splash screens change;
- the stores require a new SDK.

Steps:

1. Bump the version and build number in `ios/App` and `android/app/build.gradle`.
2. Run `bun run cap:sync` (`mobile:build`, then `cap sync`).
3. **iOS:** archive in Xcode (`bun run cap:ios`), upload, and release to TestFlight testers, then to the App Store.
4. **Android:** `./gradlew bundleRelease` with the upload keystore, then `bun run play:upload` (`scripts/upload-play-release.mjs`) to a Play track.
5. Record the released version and build in the release notes.

Push credentials (APNs key, FCM service account) are worker secrets (Appendix C).

**Desktop.** Push a `v*` tag. `desktop-release.yml` builds `.deb`, `.rpm` and AppImage for Linux, a universal `.dmg` and `.zip` for macOS, and an NSIS installer for Windows. electron-updater picks the release up. Local builds: `bun run desktop:dist`.

## 9.8 Local development

```bash
bun install                 # a real install in each worktree
bun run db:init-local       # create and migrate the local SQLite database
bun dev                     # http://localhost:3000
bun run test                # Vitest
bun run test:e2e:web        # Playwright against a seeded local database
```

Without identity-provider credentials, local development and E2E fall back to a development user. Setup for each optional module is in `docs/development/getting-started.md`.
