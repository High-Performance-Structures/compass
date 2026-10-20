# Demo environment

A separate copy of Compass for companies trying it out. It runs as its own
Cloudflare Worker (`compass-demo`) with its own D1 database (`compass-demo-db`),
configured as `env.demo` in `wrangler.jsonc`. Production data never goes in it.

The demo has no scheduled jobs and no Sage, Square, Jarvis or correspondence
connections. Sign-in uses the WorkOS staging environment, so demo accounts are
kept apart from production accounts.

## Sample company

`scripts/demo/summit-ridge-data.ts` holds a made-up company, Summit Ridge
Builders, with one or two jobs in each department, plus staff, subcontractors,
suppliers, schedules, daily logs, to-dos, client contacts and chat. Every name,
phone number (555-01xx) and email (`.example`) is fictional. Dates are counted
in work days from the day the seed is built, so the jobs always look current.

To create or reset it:

```bash
bun scripts/demo/build-summit-ridge-seed.ts --admin owner@example.com > summit-ridge.sql
bunx wrangler d1 execute compass-demo-db --env demo --remote --file summit-ridge.sql
```

A reset deletes and recreates Summit Ridge's jobs, contacts, chat and sample
staff, including anything visitors added. People who signed in keep their
accounts. Each `--admin` email becomes a Summit Ridge admin the first time that
person signs in. Invite everyone else with an invite link (Settings → Team) in the demo itself.

Only ever apply the seed to `compass-demo-db`.

## Deploying

```bash
bun scripts/run-with-deployment-id.mjs opennextjs-cloudflare build
bunx opennextjs-cloudflare deploy --env demo
bunx wrangler d1 migrations apply compass-demo-db --env demo --remote
```

The demo needs the `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` and
`WORKOS_COOKIE_PASSWORD` secrets (`wrangler secret put ... --env demo`), and its
`/callback` address must be listed as a redirect URI in WorkOS staging.

The `drizzle/seed*.sql` files are applied by `migrations apply` on a new
database. On a fresh demo database, clear their rows before seeding.
