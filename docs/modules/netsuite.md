NetSuite Integration
===

The NetSuite module is a bidirectional REST API integration that syncs customers, vendors, projects, invoices, and vendor bills between Compass (D1/SQLite) and NetSuite (Oracle's ERP). It handles OAuth 2.0 authentication, encrypted token storage, rate limiting, delta sync with conflict resolution, and per-record error tracking.

The integration exists because construction companies using NetSuite need their financial and contact data accessible in Compass without manual re-entry. NetSuite's REST API is powerful but full of surprising behaviors that this module works hard to handle gracefully.


architecture overview
---

```
src/lib/netsuite/
  config.ts              # account config, URL builders
  auth/
    oauth-client.ts      # OAuth 2.0 authorize/exchange/refresh
    token-manager.ts     # encrypted storage, auto-refresh at 80% lifetime
    crypto.ts            # delegates to shared AES-GCM crypto with netsuite salt
  client/
    base-client.ts       # HTTP client with retry, circuit breaker
    record-client.ts     # CRUD for individual records
    suiteql-client.ts    # SuiteQL query execution
    errors.ts            # error classification (the hard part)
    types.ts             # API response types, record interfaces
  rate-limiter/
    concurrency-limiter.ts  # semaphore with adaptive reduction
    request-queue.ts     # priority-based FIFO wrapper
  sync/
    sync-engine.ts       # orchestrates pull and push operations
    delta-sync.ts        # pull remote changes since last sync
    push.ts              # push local changes to netsuite
    conflict-resolver.ts # four strategies for handling conflicts
    idempotency.ts       # deterministic keys for safe retries
  mappers/
    base-mapper.ts       # abstract bidirectional field mapping
    customer-mapper.ts
    vendor-mapper.ts
    project-mapper.ts
    invoice-mapper.ts
    vendor-bill-mapper.ts
```


configuration
---

`config.ts` reads environment variables and builds URLs. The URL construction handles NetSuite's inconsistent format -- sandbox accounts use different separators (`123456-sb1` in URLs vs `123456_SB1` in the account ID):

```typescript
export function getRestBaseUrl(accountId: string): string {
  const urlId = accountId.toLowerCase().replace("_", "-")
  return `https://${urlId}.suitetalk.api.netsuite.com`
}
```

Required environment variables:

- `NETSUITE_ACCOUNT_ID` -- the account identifier (e.g., `1234567` or `1234567_SB1` for sandbox)
- `NETSUITE_CLIENT_ID` / `NETSUITE_CLIENT_SECRET` -- OAuth 2.0 integration credentials
- `NETSUITE_REDIRECT_URI` -- callback URL for the OAuth flow
- `NETSUITE_TOKEN_ENCRYPTION_KEY` -- AES-GCM key for encrypting tokens at rest
- `NETSUITE_CONCURRENCY_LIMIT` -- optional, defaults to 15


OAuth 2.0 flow
---

`auth/oauth-client.ts` implements the standard authorization code flow. The user is redirected to NetSuite's authorize endpoint with scopes `rest_webservices` and `suite_analytics`, then the callback exchanges the code for tokens using HTTP Basic authentication (client credentials in the Authorization header).

`auth/token-manager.ts` manages token lifecycle. Tokens are encrypted with AES-GCM before storage in the `netsuite_auth` table. The manager refreshes proactively at 80% of the token's lifetime to avoid edge-case expiry during a request:

```typescript
private shouldRefresh(tokens: OAuthTokens): boolean {
  const elapsed = Date.now() - tokens.issuedAt
  const threshold = tokens.expiresIn * 1000 * REFRESH_THRESHOLD
  return elapsed >= threshold
}
```

Tokens are cached in memory for the duration of a request to avoid redundant decryption.


HTTP client
---

`client/base-client.ts` wraps every NetSuite request with:

**Retry with exponential backoff.** Up to 3 retries with jittered delay (base 1s, max 30s). Only retryable errors trigger retries -- rate limits, timeouts, server errors, and expired auth (which triggers a token refresh).

**Circuit breaker.** After 5 consecutive failures, the client stops sending requests for 60 seconds. This prevents cascading failures when NetSuite is down or the account is locked out.

**Concurrency limiting.** Every request passes through the `ConcurrencyLimiter` before execution. More on this below.

The client delegates error handling to `errors.ts`, which is where most of the NetSuite-specific knowledge lives.


error classification
---

NetSuite's error responses are misleading. The `classifyError` function in `errors.ts` handles the known traps:

```typescript
if (status === 401) {
  // netsuite sometimes returns 401 for timeouts
  if (bodyStr.includes("timeout") || bodyStr.includes("ETIMEDOUT")) {
    return {
      category: "timeout",
      message: "Request timed out (disguised as 401)",
      retryAfter: null,
    }
  }
  if (bodyStr.includes("Invalid Login Attempt")) {
    return {
      category: "rate_limited",
      message: "Rate limited (disguised as auth error)",
      retryAfter: 5000,
    }
  }
}
```

Key classifications:

- **401 + "timeout" in body** = actually a timeout, not an auth failure. Retryable.
- **401 + "Invalid Login Attempt"** = actually rate limiting on SOAP connections. Retryable with 5s backoff.
- **403 + "does not exist"** = permission denied, not a missing field. The REST API returns "field doesn't exist" when the integration role lacks permission to read that field.
- **429** = actual rate limit. Parses `Retry-After` header if present, defaults to 5s.

Error categories determine retryability: `rate_limited`, `timeout`, `server_error`, `network`, and `auth_expired` are retryable. Everything else (`permission_denied`, `validation`, `not_found`) is terminal.


rate limiter
---

NetSuite enforces a limit of 15 concurrent requests across ALL integrations on an account -- SOAP, REST, RESTlets, everything. If your REST integration sends 10 requests and a SOAP integration sends 6, you'll get 429s on the 16th.

`rate-limiter/concurrency-limiter.ts` implements a semaphore with priority queuing:

```typescript
async execute<T>(fn: () => Promise<T>, priority = 0): Promise<T> {
  await this.acquire(priority)
  try {
    return await fn()
  } finally {
    this.release()
  }
}
```

The limiter also adapts: when a 429 response comes back, it reduces concurrency to 70% of the current limit. After successful requests, it gradually restores back to the original value. This handles the case where other integrations are consuming part of the shared pool.

`rate-limiter/request-queue.ts` adds named priorities on top: `critical` (30), `high` (20), `normal` (10), `low` (0). User-triggered actions get higher priority than background sync operations.


record client and SuiteQL client
---

Two client types sit on top of the base HTTP client:

`RecordClient` handles CRUD operations on individual NetSuite records. It supports field selection, query filtering, pagination (`listAll` auto-pages through results), and record transformations (e.g., converting a sales order to an invoice).

```typescript
async create(
  recordType: string,
  data: Record<string, unknown>,
  idempotencyKey?: string
): Promise<{ id: string }>
```

The `create` method accepts an optional idempotency key via the `X-NetSuite-Idempotency-Key` header. More on this in the sync section.

`SuiteQLClient` executes SQL-like queries against NetSuite's analytics engine. Delta sync uses SuiteQL to fetch only records modified since the last sync. The client auto-pages results and caps at 100,000 rows as a safety limit.


mappers
---

Mappers handle bidirectional field translation between Compass's flat D1 records and NetSuite's nested record structure. `BaseMapper` is an abstract class that provides:

- `toRemote(local)` -- convert a Compass record to NetSuite format
- `toLocal(remote)` -- convert a NetSuite record to Compass format
- `getNetSuiteRecordType()` -- the REST API record type string
- `getLocalTable()` -- the D1 table name
- `buildSelectQuery()` / `buildDeltaQuery()` -- SuiteQL generation

Here's `CustomerMapper.toLocal` as an example of the field mapping:

```typescript
toLocal(remote: NetSuiteCustomer): Partial<LocalCustomer> {
  return {
    name: remote.companyName,
    email: remote.email ?? null,
    phone: remote.phone ?? null,
    netsuiteId: remote.id,
    updatedAt: new Date().toISOString(),
  }
}
```

There are currently five mappers: customer, vendor, project, invoice, and vendor-bill.


sync engine
---

`sync/sync-engine.ts` orchestrates sync operations. It wires together config, auth, clients, and limiters into a single `SyncEngine` class:

```typescript
constructor(
  db: DrizzleD1Database,
  env: Record<string, string | undefined>,
  conflictStrategy: ConflictStrategy = "newest_wins"
)
```

The engine supports three operations:

- `pull(mapper, upsertLocal)` -- fetch changes from NetSuite, apply them locally
- `push(mapper, getLocalRecord)` -- send local changes to NetSuite
- `fullSync(mapper, upsertLocal, getLocalRecord)` -- pull then push

Every sync run is logged in the `netsuite_sync_log` table with timestamps, record counts, and error summaries.


delta sync (pull)
---

`sync/delta-sync.ts` implements the pull logic. On first sync, it runs the mapper's full `buildSelectQuery()`. On subsequent syncs, it uses `buildDeltaQuery(since)` to fetch only records modified after the last successful sync.

For each remote record, the function:

1. Looks up existing sync metadata by NetSuite internal ID
2. If the local record has `pending_push` status (local changes waiting to be sent), it runs conflict resolution
3. Otherwise, upserts the local record and updates sync metadata to `synced`
4. For new records, creates both the local record and the sync metadata entry

Conflict resolution uses one of four strategies:

- `newest_wins` -- compare timestamps, newer version wins (default)
- `remote_wins` -- always accept the remote version
- `local_wins` -- always keep the local version
- `manual` -- flag for human review in the conflict dialog UI


push
---

`sync/push.ts` sends local changes to NetSuite. It queries for all sync metadata records with `pending_push` status, then for each one:

1. Loads the current local record
2. Runs it through the mapper's `toRemote`
3. If the record has a NetSuite internal ID, sends a PATCH update
4. If it doesn't, sends a POST create with an idempotency key

The idempotency key is deterministic: `operation:recordType:localId:hourBucket`. This means retrying a failed create within the same hour reuses the key, preventing duplicate records in NetSuite. After an hour, a new key is generated so the operation can be retried if the previous attempt genuinely didn't go through.

Failed pushes are retried up to 3 times for retryable errors. Non-retryable errors mark the sync metadata as `error` with the failure message.


schema
---

The NetSuite module defines three sync-infrastructure tables and four financial tables in `src/db/schema-netsuite.ts`:

- `netsuite_auth` -- encrypted OAuth tokens per account
- `netsuite_sync_metadata` -- per-record sync status, conflict data, retry counts
- `netsuite_sync_log` -- sync run history with timing and error summaries
- `invoices` -- customer invoices (tied to customers and projects)
- `vendor_bills` -- vendor bills (tied to vendors and projects)
- `payments` -- incoming/outgoing payments
- `credit_memos` -- customer credit memos

All financial tables have a `netsuiteId` column for tracking the link to NetSuite's internal record ID.

The core schema also includes `netsuiteId` on `customers` and `vendors`, and `netsuiteJobId` on `projects`. These columns are only meaningful when the NetSuite module is active.


server actions
---

`src/app/actions/netsuite-sync.ts` exposes the sync functionality to the UI:

- `getNetSuiteConnectionStatus()` -- checks if tokens exist
- `initiateNetSuiteOAuth()` -- generates the authorize URL with a random state parameter
- `disconnectNetSuite()` -- clears stored tokens
- `syncCustomers()` / `syncVendors()` -- trigger pull operations for each entity type
- `getSyncHistory()` -- returns recent sync log entries
- `getConflicts()` -- returns records in conflict state
- `resolveConflict(metaId, resolution)` -- applies "use_local" or "use_remote" resolution

Every action checks RBAC permissions (`finance:read` for queries, `organization:update` for connection management).


UI components
---

Four components in `src/components/netsuite/`:

- `connection-status.tsx` -- shows whether NetSuite is configured and connected, with the account ID
- `sync-controls.tsx` -- trigger sync buttons for customers and vendors, shows sync history
- `conflict-dialog.tsx` -- modal for reviewing and resolving sync conflicts
- `sync-status-badge.tsx` -- inline badge showing sync state (synced, pending, error, conflict)


gotchas
---

If you're working on the NetSuite integration, know these:

1. **401 can mean timeout.** NetSuite sometimes returns 401 when a request times out. The error classifier checks the response body for "timeout" or "ETIMEDOUT" to detect this.

2. **"Field doesn't exist" usually means permission denied.** When the integration role can't access a field, the REST API says the field doesn't exist instead of returning 403.

3. **15 concurrent requests, shared globally.** The limit applies across ALL integrations on the account. Your REST integration competes with SOAP integrations, RESTlets, and scheduled scripts.

4. **No batch create/update via REST.** Every record must be created or updated individually. The SuiteQL client can batch-read, but writes are always one-at-a-time.

5. **Sandbox URLs use different separators.** Account ID `123456_SB1` becomes `123456-sb1` in REST URLs. The config handles this with `.toLowerCase().replace("_", "-")`.

6. **Omitting the "line" parameter on line items adds a new line.** If you PATCH an invoice and include line items without the `line` field, NetSuite creates new line items instead of updating existing ones. This is by design in the REST API.

7. **"Invalid Login Attempt" on 401 is often rate limiting.** SOAP connections that exceed the concurrent limit get this error. The classifier treats it as rate limiting with a 5-second backoff.
