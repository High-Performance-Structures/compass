# 7. Integrations

Compass treats every outside system as an adapter behind a boundary that Compass owns:

- a queue contract;
- a client module;
- a webhook route.

This section describes each one in the same way: its data flow, how it authenticates, how it fails, and how to replace it. Secrets appear by name only; Appendix C lists them all.

| Integration | Required? | Adapter today | Boundary to replace |
|---|---|---|---|
| Accounting | Optional | Desktop construction-accounting system (Sage 100 Contractor) through on-premises agents | The signed claim/result HTTP queue under `/api/integrations/sage/*` |
| Card payments | Optional | Square | Webhook verification and normalization (`src/lib/sage/square-*`) |
| Workspace (files, mail, calendar, meetings) | Files and mail strongly recommended | Google Workspace | `DriveClient`, `sendCompassEmail`, the calendar client and the meetings client |
| E-signature | Optional | Foxit eSign | `src/lib/foxit/esign.ts` plus the webhook route |
| Identity | Required | WorkOS | `src/middleware.ts`, `src/lib/auth.ts`, `/callback`, `/api/auth/*` |
| Weather and wildfire | Optional | Public weather and fire data services (no keys) | Fetch functions in `src/lib/weather/` |
| Legacy-system import | One-off | Buildertrend export, through offline scripts | `scripts/build-buildertrend-*.mjs` plus staging tables |
| SMS | Optional | GoTo Messaging | `src/lib/goto/` and the inbound route |
| AI | Optional | OpenAI, OpenRouter or Anthropic, chosen per company | `src/lib/agent/runtime-config.ts` |
| Push | Optional | FCM and APNs | `src/lib/push/providers.ts` |
| Gift and mailed cards | Optional | Gift-card and handwritten-card services | `src/lib/giftbit/`, `src/lib/handwrytten/` |
| Social publishing | Optional | Meta and X | OAuth routes plus `schema-social.ts` |
| Video | Optional | Cloudflare RealtimeKit | `/api/realtimekit/[...path]` |
| Issue tracker | Optional | GitHub | `src/lib/github/client.ts` |
| Legacy ERP | Dormant | NetSuite (reference implementation) | `src/lib/netsuite/` |

## 7.1 Accounting: the on-premises bridge

**Topology.** The worker never connects to the accounting database. Agents on the company network poll Compass over HTTPS, outbound only, so no inbound firewall rule is needed:

- **Linux bridge host** (Python, systemd user timers in `deploy/systemd/` and `ops/systemd/`):
  - `scripts/sage_pay_application_poller.py` is read-only. It runs `--once` each minute under a file lock.
  - `scripts/sage_square_invoice_creator_poller.py` reports who created each invoice and whether receipts have been entered.
  - `scripts/sage_square_invoice_bridge.py` / `sage_square_invoice_poller.py` turn accounting receivable invoices into payment-provider invoices in two phases (`--create-draft`, then `--publish`), with idempotency keys derived from accounting ids.
  - `scripts/square_auth_monitor.py`.

  Secrets are injected at process start by the host's secret broker; the unit files contain no values.
- **Windows accounting PC** (C#, Task Scheduler). One executable is built from:
  - `scripts/Sage.100.Contractor.CompassClientProjectWriter.cs`;
  - `…CompassContactWriter.cs`;
  - `…CompassSquareFeeWriter.cs`.

  It calls the accounting system's API library through reflection. It is installed and repaired by `install_sage_client_project_writer.ps1`, `install_sage_contact_writer_release.ps1` (which swaps the binary and restores it on failure) and `repair_sage_client_project_writer.ps1`. Logs rotate at 5 MB.

![Accounting bridge queue protocol](diagrams/accounting-bridge.png)

**Queues.** Each queue uses the same claim and result protocol:

1. `GET …/requests` claims rows. It sets `claim_token` and `claimed_at`, and re-claims rows whose claim is stale after 5 to 10 minutes.
2. `POST …/results` must echo the row id and its claim token. A stale, missing or completed claim gets 409.

| Queue | Direction | Routes (`/api/integrations/sage/`) | Tables |
|---|---|---|---|
| Pay-application snapshot | accounting → Compass (read) | `pay-applications/{requests,results}` | `sage_pay_application_sync_runs`, `sage_pay_application_snapshots` |
| Tax districts | accounting → Compass | `tax-catalog/results` | `sage_tax_entities` |
| Labor hours | accounting → Compass | `labor-hours/{requests,results}` | `sage_labor_requests`, `sage_labor_lines` |
| Client and job create | Compass → accounting (write) | `client-project-writes/{requests,results}` | `sage_write_approvals`, `sage_client_project_write_operations` |
| Contacts read, change, create | both | `contact-changes/{requests,results}`, `client-directory` | `sage_contact_*`, `sage_client_directory_*` |
| Card-processing fees to GL | Compass → accounting | `square-payments/{requests,results}` | `sage_square_payment_operations` |
| Invoice creator and receipt checks | accounting → Compass | `square-invoice-creators` | `sage_square_*` |

**Authentication** (`src/lib/sage/bridge-auth.ts`). Each request carries a timestamp, a UUID request id and an HMAC-SHA256 signature over `timestamp.requestId.METHOD.target.body`.

- The request id is stored in `sage_bridge_request_nonces` and pruned after 15 minutes, so a replay gets 409.
- The body limit is 1 MB.
- Secrets must be at least 32 characters. There are three, so each agent can be revoked separately: `SAGE_BRIDGE_SECRET` (client/job writer, fee writer), `SAGE_CONTACT_BRIDGE_SECRET` and `SAGE_PAY_APPLICATION_BRIDGE_SECRET`.

**Two keys for every write.** A write needs a switch on each side:

- the worker's `vars`: `SAGE_CLIENT_PROJECT_WRITES_ENABLED`, `SAGE_CONTACT_WRITES_ENABLED`, `SAGE_CONTACT_CREATES_ENABLED`, `SAGE_SQUARE_PAYMENT_WRITES_ENABLED`;
- the agent's own machine variables.

`SAGE_SQUARE_ORGANIZATION_ID` and `SAGE_CONTACT_ORGANIZATION_ID` pin the bridge to one tenant. The demo environment turns every switch off.

**Failure modes.**

- **Agent offline.** Every requests route updates a heartbeat in `sage_bridge_status`. The 10-minute health job (`src/lib/sage/bridge-health.ts`) notifies admins when a heartbeat is more than 5 minutes old, and the notification clears itself when the agent returns.
- **Stuck claims.** Rows whose claims keep going stale are failed instead of looping.
- **Duplicates.** The fee writer looks for an existing matching entry before posting.
- **Contact changes** go through human review (feature `sage-contact-review`).

**How to replace the accounting system.** Write a new agent that implements the same claim/result protocol and payload schemas (zod schemas in `src/lib/sage/*.ts`, such as `client-project-write.ts`). The worker does not change. Accounting-specific business rules live in `src/lib/sage/` and `src/lib/domain/sage-bridge/`; a different accounting product would add sibling modules and its own queue routes. Accounting itself stays optional: with no bridge, the queues simply wait, and Compass works as a stand-alone system.

**Legacy ERP.** `src/lib/netsuite/` is a complete, dormant reference implementation:

- OAuth 2.0 with token refresh at 80% of lifetime;
- tokens encrypted with AES-GCM;
- a 15-request concurrency limiter;
- delta sync with conflict resolution.

Its environment variables are not in the required secrets. Keep it as a pattern for a cloud ERP adapter.

## 7.2 Card payments

- **Data flow.** Section 6.6 traces it. Inbound: `/api/integrations/square/webhook`. Outbound: payment-details reads with `SQUARE_PRODUCTION_ACCESS_TOKEN`.
- **Authentication.** The webhook signature is `base64(HMAC-SHA256(SQUARE_WEBHOOK_SIGNATURE_KEY, notificationUrl + rawBody))`, with a 512 KB body limit. Flags: `SAGE_SQUARE_PAYMENT_WEBHOOK_ENABLED`, `SAGE_SQUARE_PAYMENT_CUTOFF_AT` (events before this time are ignored).
- **Failure modes.**
  - Duplicate events are idempotent.
  - Attention errors return 200 and notify staff.
  - Other errors return 500, so the provider redelivers.
  - Credential health is checked every minute (`/api/operations/square/auth-health`). The bridge host's monitor also posts signed observations; an observation more than 5 minutes old raises an alert to the user named by `SQUARE_AUTH_NOTIFICATION_USER_ID`.
- **Replacing it.** There is no generic payments interface yet. Replace the webhook verification and normalization step and `processSquareWebhookEvent`. Keep the `sage_square_payment_operations` queue, which faces the accounting system, not the payment provider.

## 7.3 Workspace: files, mail, calendar and meetings

- **Files (Drive).**
  - The company's service-account key is stored per organization in `google_auth`, encrypted with `GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY` (`src/lib/google/config.ts`).
  - Domain-wide delegation lets Compass act as the signed-in user (`src/lib/google/auth/service-account.ts`), with tokens cached per user.
  - `DriveClient` (`src/lib/google/client/drive-client.ts`) retries once after a 401, and backs off and lowers concurrency on 429 and 5xx.
  - Outside viewers are authorized by Compass records, and files are streamed through `/api/google/download/[fileId]`.
- **Mail.**
  - Sending: `sendCompassEmail` (`src/lib/email/compass-email.ts`) sends with the `gmail.send` scope, as the staff member or a department mailbox. It falls back to a transactional provider (`COMPASS_EMAIL_PROVIDER`).
  - Inbound: `syncGmailInboundReplies` reads with `gmail.readonly` every minute (section 6.7).
  - Correspondence features are switched by `COMPASS_CORRESPONDENCE_ENABLED`.
- **Calendar.**
  - Personal calendar connections use per-user OAuth (`/api/google/calendar/{connect,callback}`, `GOOGLE_OAUTH_*`). Refresh tokens are encrypted with `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` and a per-user salt.
  - App-created personal and project calendars sync every minute, with a 5-minute throttle per item.
- **Meetings.** The meetings API (`meetings.space.readonly`) fetches transcripts 10 minutes after a call, rechecks every 10 minutes, stops after 24 hours, and saves the transcript to the project folder.
- **Spreadsheet trackers.** The project registry and department trackers are spreadsheets (`src/lib/google/project-intake-tracker.ts`). Scripts that run inside the workspace hand off to Compass with the bearer token `GOOGLE_PROJECT_MANAGER_HANDOFF_TOKEN`.
- **Failure modes.**
  - Missing delegation scopes show up as 403s, which are surfaced in Settings → Integrations.
  - Paper-trail copies are retried by the per-minute job and marked `failed` after errors.
  - Inbound sync throws if any company's summary reports errors, so the failure appears in the worker logs.
- **Replacing it.**
  - Files: implement the `DriveClient` interface (`src/lib/google/client/types.ts`) for another drive and keep Compass's sharing records.
  - Mail: change `sendCompassEmail` and the inbound sync. The reply-token scheme is provider-neutral.
  - Calendars and meetings have their own client modules.

## 7.4 E-signature

- **Data flow.**
  - `createFoxitPreparedEnvelope` (`src/lib/foxit/esign.ts`) sends a PDF, the parties, the fields and an optional signing order.
  - The webhook `/api/integrations/foxit/webhook` maps events onto estimates, contract packets and trade letters:
    - `folder_sent` → `signature_pending`;
    - `folder_cancelled` / `folder_declined` → cancelled or declined;
    - `folder_executed` → the signed document is stored and the record is accepted or executed.
  - `downloadFoxitExecutedEnvelope` fetches the signed copy.
- **Authentication.** API calls use `FOXIT_ESIGN_CLIENT_ID` and `FOXIT_ESIGN_CLIENT_SECRET`. The webhook is verified by an HMAC-SHA256 of the body with `FOXIT_ESIGN_WEBHOOK_SECRET`, compared in constant time.
- **Failure modes.** Handlers are guarded by the record's current status, so replays do nothing. Errors return 500 so the provider redelivers. Staff can always record acceptance manually with evidence.
- **Replacing it.** Only `esign.ts` and the webhook route are provider-specific. Records keep a provider status (`foxit_status`) and a signature package link.

## 7.5 Weather and wildfire

- **Data flow.** `refreshWeatherCache` (`src/lib/weather/refresh-server.ts`) runs every 10 minutes and works within an 18-second budget. It fetches:
  - from the national weather service API: forecast zones, active alerts by state, points and gridpoint forecasts;
  - from the national interagency fire feature services: active fire points and perimeters (`src/lib/weather/fires.ts` simplifies the outlines).

  Site forecasts are refreshed only for cells that someone viewed recently. `sweepScheduleWeatherRisks` then checks upcoming outdoor work against the company's limits.
- **Other public lookups.** Daily-log weather uses station observations, with a historical archive for past dates. Site lookup uses a public geocoder, an elevation service and map-feature services (`src/lib/geo/`).
- **Authentication.** None. Requests send an identifying User-Agent.
- **Failure modes.** Each step is isolated. Failures are recorded per snapshot (`markSnapshotFailure`) and counted in the run summary, and stale data is kept.
- **Replacing it.** Each source is one fetch function that writes normalized rows into `weather_*` tables. Swap the function and keep the tables. A company outside the United States would add regional providers behind the same functions.

## 7.6 Identity

- **Data flow.** Sign-in, SSO and invitations go through the hosted provider (WorkOS AuthKit). Compass keeps its own `users`, `organizations` and `organization_members`, keyed by the provider's user id.
- **Authentication.** The provider's settings are `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_COOKIE_MAX_AGE`, `WORKOS_REDIRECT_URI` and `NEXT_PUBLIC_WORKOS_REDIRECT_URI`. `isWorkOSConfigured` treats placeholder values as missing.
- **Failure modes.**
  - If the provider is not configured, production API calls return 503 and pages redirect with `auth_unavailable`. Local development and E2E use a fallback user.
  - The login call times out after 12 seconds.
  - Invitation emails are retried by the per-minute recovery job.
- **Replacing it.** The provider is used only in `src/middleware.ts`, `src/lib/auth.ts` (`withAuth`), `src/app/callback/route.ts` and `src/app/api/auth/*`. Everything else uses `AuthUser`, `getCurrentUser()` and `requireAuth()`. Branding of hosted invitation screens is set in the provider's dashboard.

## 7.7 Legacy-system import

The legacy project-management system is imported offline. There is no runtime connection.

1. **Capture.** An operator captures an export and produces a JSON manifest.
2. **Build SQL.** `bun scripts/build-buildertrend-staging-sql.mjs --input … --organization-id … [--dry-run]` writes a SQL file.
3. **Apply.** An operator applies the SQL to D1.
4. **Further builders.** Sibling builders cover identity review, lead-to-project cutover, schedules, daily logs, photos, PDFs, correspondence, change orders and templates. Each has a test.

**Staging** (`src/db/schema-buildertrend.ts`). The staging tables hold runs, records, files, observations, identity decisions and relationships, and module attestations.

- Every staged record keeps the source ids, raw payload and archive pointers.
- Records are unique on (organization, source key).
- `review_status` defaults to `needs_review`, and `promotion_status` defaults to `archive_only`.

**Idempotency** (`src/lib/domain/buildertrend/`):

- the manifest has a SHA-256 fingerprint;
- entity ids are deterministic (`stableId`);
- duplicate source keys are rejected;
- upserts use `ON CONFLICT DO UPDATE`;
- a different manifest for the same run marks it `manifest_conflict`;
- diverging evidence marks rows `reference_conflict` / `evidence_conflict` for review.

Guard checks abort before any durable write (fail-closed).

**Rule for imported data.** Import only what exists solely in the legacy system. Do not re-import files already in the shared drive, and do not duplicate photos (aliases map them). Imported rows keep their original dates, and every promoted row records its source system.

**Replacing it.** For a different legacy system, write a new manifest builder that targets the same staging tables, or new staging tables with the same `(source_system, source_*_id)` uniqueness rule. Promotion goes through the normal domain stores.

## 7.8 Other adapters

- **SMS.**
  - Inbound: `/api/integrations/goto/inbound`, with a shared secret in the query string. `JARVIS_BRIDGE_ORGANIZATION_ID` pins the tenant, and the handler answers within 2 seconds.
  - Outbound: `GOTO_SMS_ACCESS_TOKEN`, or OAuth with `GOTO_CLIENT_ID` and `GOTO_CLIENT_SECRET`.
  - Message bodies that arrive empty are recovered every 10 minutes.
- **AI providers.** The per-company provider setting wins. Otherwise the first key present among `OPENAI_API_KEY`, `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` is used. Per-company keys are encrypted with `PROVIDER_KEY_ENCRYPTION_KEY`. Transcription uses the `AI` binding.
- **Push.**
  - FCM uses `FIREBASE_SERVICE_ACCOUNT_JSON`.
  - APNs uses `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID` and `APNS_ENVIRONMENT`.
- **External agent bridge.** This is an optional connection to an outside agent runtime and the feedback desk, under `/api/integrations/jarvis/*`. Requests are signed with `JARVIS_BRIDGE_SECRET`, with an optional secondary secret for rotation. The switches are `JARVIS_AGENT_BRIDGE_ENABLED` and `ASK_JARVIS_RELAY_ENABLED`.
- **MCP / local bridge.** `/api/bridge/*` takes a bearer API key, which is stored hashed in `mcp_api_keys` (`src/lib/mcp/auth.ts`).
