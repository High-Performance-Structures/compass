Google Drive Integration
===

Compass connects to a Google Workspace via the Drive API v3, replacing the mock file data with real cloud storage. The integration uses domain-wide delegation, which means a single service account impersonates each Compass user by their Google Workspace email. This is worth understanding because it determines how permissions work, how authentication flows, and why the setup requires Google Workspace admin access.


Why domain-wide delegation
---

There were two realistic options for connecting Compass to Google Drive: OAuth per-user or domain-wide delegation via a service account.

Per-user OAuth would require every Compass user to individually authorize the app through a Google consent screen, creating friction on a construction site where field workers need immediate file access. It also requires managing refresh tokens per user and handling re-authorization when tokens expire.

Domain-wide delegation avoids this entirely. A Google Workspace admin grants the service account access to Drive scopes once, and from that point, every Workspace user is accessible without individual consent flows. The service account impersonates each user by setting the `sub` claim in its JWT, so every API call runs as that specific user with their own Drive permissions. This means Google's native sharing model is preserved - if a user can't access a file in Google Workspace, the API returns 403 to Compass as well.

The tradeoff is that setup requires access to both the Google Cloud Console (to create the service account and enable the Drive API) and the Google Workspace Admin Console (to grant domain-wide delegation scopes). This is a one-time administrative action, but it does require someone with admin access to both systems.


How the two permission layers work
---

Every file operation passes through two gates, and this is the most important architectural decision in the integration.

**Compass RBAC** runs first. The role-based permissions defined in `src/lib/permissions.ts` determine what *type* of operation a user can attempt. Admin users get full CRUD plus approve. Office staff get create, read, update. Field workers get create and read. Client users get read only. This check happens before any Google API call is made, so a field worker can never trigger a delete operation regardless of their Google permissions.

**Google Workspace permissions** run second, implicitly. Because the API call is made as the user (via impersonation), Google enforces whatever sharing and access rules exist in the Workspace. If a file is in a Shared Drive that the user doesn't have access to, Google returns 404. If the user has view-only access to a file, Google rejects a PATCH request. No mapping logic is needed - the impersonation itself is the enforcement mechanism.

This means Compass can restrict operations *beyond* what Google allows (a field worker with Google editor access still can't delete through Compass), but it cannot grant access *beyond* what Google allows (an admin who doesn't have a Google Workspace account can't browse files).


User-to-Google email mapping
---

Most Compass users will have the same email in both systems. For cases where they don't (someone whose Compass email is `nicholai@biohazardvfx.com` but whose Workspace email is different), the `users` table has a `googleEmail` column that overrides the default.

The resolution logic is straightforward: use `googleEmail` if set, otherwise fall back to `email`. If the resolved email doesn't exist in the Workspace, the Google API call fails and Compass returns a user-facing error. An admin can set override emails through the settings UI.


Architecture
---

### Library structure

```
src/lib/google/
  config.ts                  - config types, API URLs, scopes, crypto salt
  auth/
    service-account.ts       - JWT creation and token exchange (RS256 via Web Crypto)
    token-cache.ts           - per-request in-memory cache (see note below)
  client/
    drive-client.ts          - REST wrapper with retry, rate limiting, impersonation
    types.ts                 - Google Drive API v3 response types
  mapper.ts                  - DriveFile -> FileItem type mapping
```

The library uses the Web Crypto API exclusively for JWT signing, which is the only option on Cloudflare Workers (no Node.js crypto module). The service account's private key (RSA, PEM-encoded) is imported as a CryptoKey and used for RS256 signatures. This works identically in Workers, Node, and Deno.

### Token caching

A note on the token cache: in Cloudflare Workers, each request runs in its own isolate, so an in-memory `Map` resets on every request. The cache is effectively a no-op in production. Each request generates a fresh JWT and exchanges it for an access token. This adds roughly 100ms of latency per request but avoids the complexity of KV-backed caching. If this becomes a measurable problem, the cache can be swapped to Workers KV without changing any calling code.

### Rate limiting and retry

The `DriveClient` uses the same `ConcurrencyLimiter` from the NetSuite integration, defaulting to 10 concurrent requests. On 429 responses, it reduces concurrency automatically. On 401 responses, it clears the cached token and retries (the service account token may have expired). On 5xx responses, it retries with exponential backoff up to 3 attempts.

### Encryption at rest

The service account JSON key is encrypted with AES-256-GCM before storage in D1. The encryption module in `src/lib/crypto.ts` is shared between the Google and NetSuite integrations, parameterized by a salt string so the same encryption key can be used for both without deriving identical keys.

The encryption key itself lives in the Cloudflare Workers environment (`GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY`), not in D1. This means a database export alone doesn't expose the service account credentials.


Database schema
---

Migration `0015_busy_photon.sql` adds two tables and one column:

**google_auth** stores one record per organization containing the encrypted service account key, workspace domain, and optional shared drive selection. The `connectedBy` column tracks which admin set up the connection.

**google_starred_files** stores per-user file stars. These are local to Compass rather than using Google's native starring, because the service account impersonation means each user's stars would actually be the service account's stars. This table solves that by keeping star state in D1.

**users.google_email** is a nullable text column for overriding the default email used for impersonation.


Server actions
---

All 16+ server actions live in `src/app/actions/google-drive.ts` and follow the standard Compass pattern: `"use server"`, authenticate with `requireAuth()`, check permissions with `requirePermission()`, return a discriminated union.

### Connection management (admin only)

- `connectGoogleDrive(keyJson, domain)` - encrypts and stores the service account key, validates by making a test API call
- `disconnectGoogleDrive()` - deletes the google_auth record
- `listAvailableSharedDrives()` - lists drives visible to the service account
- `selectSharedDrive(id, name)` - sets which shared drive to browse by default

### File operations (RBAC-gated)

- `listDriveFiles(folderId?, pageToken?)` - browse a folder
- `listDriveFilesForView(view, pageToken?)` - shared, recent, starred, trash views
- `searchDriveFiles(query)` - fulltext search via Google's `fullText contains` query
- `createDriveFolder(name, parentId?)` - requires `document:create`
- `renameDriveFile(fileId, newName)` - requires `document:update`
- `moveDriveFile(fileId, newParentId, oldParentId)` - requires `document:update`
- `trashDriveFile(fileId)` - requires `document:delete`
- `restoreDriveFile(fileId)` - requires `document:update`
- `getUploadSessionUrl(fileName, mimeType, parentId?)` - initiates a resumable upload session; returns the session URL for client-side upload directly to Google
- `getDriveStorageQuota()` - returns used and total bytes
- `getDriveFileInfo(fileId)` - single file metadata
- `listDriveFolders(parentId?)` - folders only, for the move dialog

### Local operations

- `toggleStarFile(googleFileId)` - D1 operation, no Google API call
- `getStarredFileIds()` - returns starred IDs for current user
- `updateUserGoogleEmail(userId, email)` - admin sets override email


Upload flow
---

Uploads use Google's resumable upload protocol. The server creates an upload session (which returns a time-limited, single-use URL), and the client uploads directly to Google via XHR with progress tracking. This avoids proxying file bytes through the Cloudflare Worker, which has request body size limits and would double the bandwidth cost. The upload URL is scoped to a single file and expires, so exposure is limited.


Download flow
---

Downloads are proxied through the worker at `/api/google/download/[fileId]`. The route authenticates the user, checks permissions, and streams the file content from Google through the response. For Google-native files (Docs, Sheets, Slides), it exports them as PDF or xlsx before streaming. This proxy is necessary because the Google API requires authentication that the browser doesn't have.


File type mapping
---

The mapper in `src/lib/google/mapper.ts` converts Google Drive's MIME types to Compass's `FileType` union. Google-native apps types (`application/vnd.google-apps.*`) get special treatment:

- `apps.folder` -> `"folder"`
- `apps.document` -> `"document"` (opens in Google Docs via `webViewLink`)
- `apps.spreadsheet` -> `"spreadsheet"` (opens in Google Sheets)
- `apps.presentation` -> `"document"` (opens in Google Slides)

Standard MIME types are mapped by prefix (`image/*`, `video/*`, `audio/*`) or by keyword matching for archives, spreadsheets, documents, and code files. Anything unrecognized becomes `"unknown"`.


UI changes
---

### File browser

The `use-files.tsx` hook was rewritten from a pure client-side reducer with mock data to a server-action-backed fetcher. Local state (view mode, sort order, selection, search query) still lives in a reducer. File data comes from async server action calls. When Google Drive isn't connected, the hook falls back to mock data and the browser shows a "Demo Mode" banner prompting the admin to connect.

### Components

Every file operation component (upload, rename, move, new folder, context menu) was updated to call server actions when connected and fall back to the mock dispatch when not. The breadcrumb resolves folder ancestry by walking up the `parents` chain via `getDriveFileInfo()` calls.

### Routes

- `/dashboard/files` - root file browser (shows drive root or shared drive root)
- `/dashboard/files?view=shared|recent|starred|trash` - view filters
- `/dashboard/files/folder/[folderId]` - browse a specific folder by Google Drive ID

### Settings

The settings modal's Integrations tab now includes a Google Drive section with connection status, service account upload dialog, shared drive picker, and user email mapping.


Setup
---

### Google Cloud Console

1. Create a project (or use an existing one)
2. Enable the Google Drive API
3. Create a service account
4. Enable domain-wide delegation on the service account
5. Download the service account JSON key

### Google Workspace Admin Console

1. Go to Security -> API Controls -> Domain-wide Delegation
2. Add the service account's client ID
3. Grant scope: `https://www.googleapis.com/auth/drive`

### Compass

1. Set `GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY` in `.dev.vars` (local) or via `wrangler secret put` (production). This can be any random string - it's used to derive an AES-256 key for encrypting the service account JSON at rest.
2. Run `bun run db:migrate:local` (or `bun run db:migrate:prod` for production)
3. Start the app, go to Settings -> Integrations -> Google Drive
4. Upload the service account JSON key and enter the workspace domain
5. Optionally select a shared drive to scope the file browser


Known limitations
---

**Token caching is per-request.** Each request generates a new service account JWT and exchanges it for an access token. For typical usage this adds negligible latency, but high-traffic deployments might want KV-backed caching.

**Breadcrumb resolution is sequential.** Resolving a folder's ancestry requires one API call per parent level. Most folders are 2-4 levels deep, so this is 200-400ms of async resolution. The UI renders immediately and fills in breadcrumb segments as they resolve.

**Stars are local.** Because impersonation shares a single service account identity, Google's native star feature can't be used per-user. Stars are stored in D1 instead, which means they don't appear in the Google Drive web UI.

**No real-time sync.** Files are fetched on navigation. If someone adds a file through the Google Drive web UI, it appears in Compass on the next folder load. There's no push notification or polling.

**Single-organization model.** The `getOrgGoogleAuth()` helper grabs the first google_auth record without filtering by organization ID. This is correct for the current single-tenant-per-D1-instance architecture but would need a WHERE clause if multi-tenancy is added.
