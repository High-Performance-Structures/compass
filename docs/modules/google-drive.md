Google Drive Integration
===

The Google Drive module gives Compass users a native file browser that reads from and writes to Google Workspace. It uses domain-wide delegation via a service account, which means no per-user OAuth consent flow -- the service account impersonates workspace users directly using JWT-based authentication.

This design was chosen because construction companies typically have a Google Workspace domain and want all project documents accessible in Compass without each user having to individually authorize access. The tradeoff is that setup requires a Workspace admin to configure domain-wide delegation in the Google Admin console.


architecture overview
---

```
src/lib/google/
  config.ts                     # encryption key, service account type, API URLs
  auth/
    service-account.ts          # JWT creation + token exchange (Web Crypto API)
    token-cache.ts              # in-memory per-user token cache
  client/
    drive-client.ts             # REST API v3 wrapper with retry + rate limiting
    types.ts                    # DriveFile, DriveFileList, DriveAbout, etc.
  mapper.ts                     # DriveFile -> FileItem conversion

src/app/actions/google-drive.ts # 17 server actions
src/db/schema-google.ts         # google_auth, google_starred_files
src/components/files/           # file browser UI (14 components)
```


domain-wide delegation
---

Standard OAuth requires each user to click "Allow" in a consent screen. Domain-wide delegation skips this: a service account is authorized (once, by an admin) to impersonate any user in the Workspace domain.

The flow:

1. Admin creates a service account in Google Cloud Console
2. Admin grants the service account domain-wide delegation in Google Admin
3. Admin pastes the service account JSON key into Compass settings
4. Compass encrypts and stores the key in the `google_auth` table
5. For each API request, Compass creates a JWT claiming to be the user, signs it with the service account's private key, and exchanges it for an access token

This means Compass sees exactly what each user would see in Google Drive. If Alice can't access a folder in Workspace, she can't access it in Compass either.


JWT creation with Web Crypto
---

`auth/service-account.ts` builds JWTs without any Node.js crypto dependencies, using only the Web Crypto API. This is necessary because Compass runs on Cloudflare Workers, which doesn't have Node.js built-ins.

The JWT contains:

```typescript
const payload = {
  iss: serviceAccountKey.client_email,  // service account email
  sub: userEmail,                        // user to impersonate
  scope: scopes.join(" "),               // "https://www.googleapis.com/auth/drive"
  aud: GOOGLE_TOKEN_URL,
  iat: now,
  exp: now + 3600,                       // 1 hour
}
```

The private key is imported from PEM format into a CryptoKey object for RS256 signing:

```typescript
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "")

  const binaryString = atob(pemBody)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  return crypto.subtle.importKey(
    "pkcs8", bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  )
}
```

The signed JWT is exchanged for a standard OAuth access token via Google's token endpoint with the `urn:ietf:params:oauth:grant-type:jwt-bearer` grant type.


drive client
---

`client/drive-client.ts` wraps the Google Drive REST API v3. Each method accepts a `userEmail` parameter for impersonation.

The client has:

**Token caching.** Access tokens are cached in memory per user email with a 1-hour TTL. The cache is per-worker-isolate, so different Cloudflare Workers instances maintain separate caches. On 401 responses, the cached token is cleared and the request retries.

**Rate limiting.** Reuses the same `ConcurrencyLimiter` from the NetSuite module (defaulting to 10 concurrent requests). On 429 responses, concurrency is adaptively reduced.

**Retry with exponential backoff.** Up to 3 attempts for 401 (auth refresh), 429 (rate limit), and 5xx (server error). Non-retryable errors (400, 403, 404) fail immediately.

Available operations:

- `listFiles` -- list files in a folder with query filtering, ordering, pagination, shared drive support
- `getFile` -- get a single file's metadata
- `createFolder` -- create a folder in a specified parent
- `initiateResumableUpload` -- start a resumable upload session (returns a session URI)
- `downloadFile` -- download file content
- `exportFile` -- export a Google Docs/Sheets/Slides file to a different format (e.g., PDF)
- `renameFile` -- rename a file
- `moveFile` -- move a file between parents
- `trashFile` / `restoreFile` -- soft delete and restore
- `getStorageQuota` -- get the user's storage usage
- `searchFiles` -- full-text search across files
- `listSharedDrives` -- enumerate shared drives the user can access


two-layer permissions
---

Every file operation goes through two permission checks:

1. **Compass RBAC** -- the server action checks `requirePermission(user, "document", "read|create|update|delete")`. This determines whether the user's Compass role allows the operation at all.

2. **Google Workspace permissions** -- the API request is made as the impersonated user. Google enforces whatever sharing permissions apply to that user's account. If a user doesn't have edit access to a folder in Drive, the `createFolder` call will fail with a 403 from Google.

The Google email used for impersonation defaults to the user's login email but can be overridden via the `googleEmail` column on the `users` table. This handles cases where a user's Compass login email differs from their Workspace email.

```typescript
function resolveGoogleEmail(user: AuthUser): string {
  return user.googleEmail ?? user.email
}
```


mapper
---

`mapper.ts` converts Google Drive API responses into Compass's `FileItem` type for the UI. The mapper handles:

- MIME type to file type classification (folder, document, spreadsheet, image, video, etc.)
- Permission role mapping (Google's `writer`/`owner` become `editor`, everything else becomes `viewer`)
- Owner and sharing info extraction
- Local starred file tracking (via the `google_starred_files` table, since Google's star API is per-Google-account, not per-Compass-user)

Google Docs, Sheets, and Slides are "native" files that can't be downloaded directly. The mapper includes `getExportMimeType` to determine what format to export them as (Docs -> PDF, Sheets -> XLSX, Slides -> PDF).


server actions
---

`src/app/actions/google-drive.ts` exports 17 actions:

**Connection management:**
- `getGoogleDriveConnectionStatus` -- checks if a service account key is stored
- `connectGoogleDrive` -- validates and stores the service account key (makes a test API call first)
- `disconnectGoogleDrive` -- deletes the stored key
- `listAvailableSharedDrives` -- lists shared drives for the setup UI
- `selectSharedDrive` -- sets the default shared drive for the org

**File operations:**
- `listDriveFiles` -- list files in a folder (or shared drive root)
- `listDriveFilesForView` -- list files for special views: shared, recent, starred, trash
- `searchDriveFiles` -- full-text search
- `getDriveFileInfo` -- get metadata for a single file
- `listDriveFolders` -- list only folders (for move dialog)
- `createDriveFolder` -- create a new folder
- `renameDriveFile` -- rename a file or folder
- `moveDriveFile` -- move a file between folders
- `trashDriveFile` / `restoreDriveFile` -- soft delete and restore
- `getUploadSessionUrl` -- initiate a resumable upload and return the session URL
- `getDriveStorageQuota` -- get storage usage info

**User preferences:**
- `toggleStarFile` -- star/unstar a file (stored locally, not in Google)
- `getStarredFileIds` -- get the current user's starred file IDs
- `updateUserGoogleEmail` -- set a user's Google impersonation email override

Each action follows the same structure: authenticate, check RBAC, resolve the Google email, build a `DriveClient`, execute the operation, map results.


schema
---

`src/db/schema-google.ts` defines two tables:

**`google_auth`** -- organization-level Google connection. One row per org. Stores the encrypted service account key, workspace domain, optional shared drive selection, and who connected it.

**`google_starred_files`** -- per-user file starring. References user ID and stores the Google file ID. Stars are local to Compass because Google's starring is per-Google-account, not per-app.


file browser UI
---

`src/components/files/` contains 14 components that make up the file browser:

- `file-browser.tsx` -- main container, manages folder navigation state and view mode
- `file-grid.tsx` / `file-list.tsx` -- grid and list view layouts
- `file-item.tsx` / `file-row.tsx` -- individual file rendering for grid and list views
- `file-icon.tsx` -- MIME type to icon mapping
- `file-breadcrumb.tsx` -- folder path breadcrumb navigation
- `file-toolbar.tsx` -- view toggles, search, upload button
- `file-context-menu.tsx` -- right-click menu with rename, move, trash, star, open in Drive
- `file-drop-zone.tsx` -- drag-and-drop file upload area
- `file-upload-dialog.tsx` -- upload progress dialog
- `file-new-folder-dialog.tsx` -- folder creation dialog
- `file-rename-dialog.tsx` / `file-move-dialog.tsx` -- rename and move dialogs
- `storage-indicator.tsx` -- storage usage bar


encryption
---

The service account key JSON is encrypted at rest using the same shared AES-GCM encryption used by the NetSuite module (`src/lib/crypto.ts`), but with a Google-specific PBKDF2 salt (`compass-google-service-account`). The encryption key comes from the `GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY` environment variable.

This means the service account's private RSA key is never stored in plaintext in D1. Decryption happens per-request when the `DriveClient` is constructed.


setup reference
---

For the full setup guide (Google Cloud Console configuration, domain-wide delegation setup, admin permissions), see `docs/google-drive/GOOGLE-DRIVE-INTEGRATION.md`.
