Desktop Module
===

The desktop module wraps Compass in a native Windows, macOS, and Linux application using Tauri v2. Unlike the mobile app (which loads a remote URL in a WebView), the desktop app runs the entire Next.js application locally with a SQLite database. This means genuine offline support: you can create projects, edit schedules, and manage data without any network connection, then sync when connectivity returns.

The design principle mirrors the mobile module: **the web app doesn't know or care that it's running on desktop.** Platform detection (`isTauri()`) gates native features, but the React components, server actions, and data layer work identically whether the app is served from Cloudflare or running from a local Tauri binary.


why local sqlite
---

Cloudflare D1 is excellent for the hosted version--edge-co-located, zero-config, single-digit-millisecond latency. But it requires a network connection. For a construction project management tool, this is a genuine limitation. Jobsites often have spotty or no connectivity. A superintendent walking a site needs to check schedules, update task status, and capture notes without wondering if the API will respond.

The desktop app solves this by running SQLite locally via `@tauri-apps/plugin-sql`. The local database holds a subset of the remote data: the projects you've accessed, the schedules you're working on, the teams you belong to. When online, a sync engine pulls remote changes and pushes local mutations. When offline, the app works normally--the only difference is a small amber indicator showing pending sync count.

This isn't a PWA with a service worker cache. It's a real database with real queries, conflict resolution, and durability guarantees. The tradeoff is complexity: we maintain two database providers (D1 and SQLite), a sync protocol, and conflict resolution logic. But for desktop users who need reliable offline access, the tradeoff is worth it.


architecture
---

```
src-tauri/
├── src/
│   ├── lib.rs              # App initialization, platform fixes
│   ├── commands/           # Rust commands exposed to frontend
│   │   ├── database.rs     # db_query, db_execute, db_init
│   │   ├── sync.rs         # get_sync_status, trigger_sync
│   │   └── platform.rs     # get_platform_info, get_display_server
│   └── error.rs            # AppError enum with From implementations
├── capabilities/
│   └── default.json        # Security permissions (HTTP, filesystem, SQL)
├── migrations/
│   └── initial.sql         # SQLite schema for local database
└── tauri.conf.json         # Window config, CSP, bundle settings

src/
├── db/provider/
│   ├── interface.ts        # DatabaseProvider type, isTauri(), detectPlatform()
│   └── tauri-provider.ts   # SQLite implementation via @tauri-apps/plugin-sql
├── lib/sync/
│   ├── engine.ts           # Pull/push sync, conflict resolution
│   ├── clock.ts            # Vector clocks for causal ordering
│   ├── conflict.ts         # Last-write-wins with clock comparison
│   ├── schema.ts           # local_sync_metadata, mutation_queue tables
│   └── queue/
│       ├── mutation-queue.ts   # Local operation queue with persistence
│       └── processor.ts        # Retry logic with exponential backoff
├── hooks/
│   ├── use-desktop.ts      # Platform detection hook
│   └── use-sync-status.ts  # Sync state, pending count, trigger function
└── components/desktop/
    ├── desktop-shell.tsx   # Context provider, beforeunload sync check
    ├── sync-indicator.tsx  # Badge showing sync status
    └── offline-banner.tsx  # Warning when offline with pending changes
```

The Rust side is thin by design. `lib.rs` initializes the Tauri plugins (SQL, HTTP, filesystem, window state), registers the command handlers, and applies platform-specific fixes at startup. The commands are simple pass-throughs--the real logic lives in TypeScript. This keeps the Rust surface area small and lets us share code between web and desktop.


platform detection
---

`src/db/provider/interface.ts` provides the detection layer:

```typescript
export function isTauri(): boolean {
  if (typeof window === "undefined") return false
  return "__TAURI__" in window
}
```

The `__TAURI__` global is injected by the Tauri runtime before JavaScript executes. This means the check works after hydration but not during SSR--server-rendered HTML assumes web, and the desktop state is only known client-side.

`detectPlatform()` returns `"tauri"`, `"d1"`, or `"memory"` based on the runtime environment. This determines which database provider the sync engine uses:

```typescript
export function detectPlatform(): ProviderType {
  if (isTauri()) return "tauri"
  if (isCloudflareWorker()) return "d1"
  return "memory"
}
```


the database provider interface
---

Both D1 and Tauri SQLite implement the same `DatabaseProvider` interface:

```typescript
export interface DatabaseProvider {
  readonly type: ProviderType
  getDb(): Promise<DrizzleDB>
  execute(sql: string, params?: unknown[]): Promise<void>
  transaction<T>(fn: (db: DrizzleDB) => Promise<T>): Promise<T>
  close?(): Promise<void>
}
```

The Tauri provider uses `@tauri-apps/plugin-sql` which provides raw SQL execution:

```typescript
async function initializeDatabase(config?: TauriProviderConfig): Promise<TauriSqlDb> {
  if (dbInstance) return dbInstance
  if (dbInitPromise) return dbInitPromise  // Prevent concurrent init

  dbInitPromise = (async () => {
    const { default: Database } = await import("@tauri-apps/plugin-sql")
    dbInstance = await Database.load("sqlite:compass.db")
    return dbInstance
  })()

  return dbInitPromise
}
```

The dynamic import is important--`@tauri-apps/plugin-sql` doesn't exist outside Tauri. A top-level import would crash the web app at module evaluation time. The same pattern appears in the mobile module with Capacitor plugins.

Transactions are handled manually since the Tauri SQL plugin doesn't provide a transaction API:

```typescript
async transaction<T>(fn: (db: DrizzleDB) => Promise<T>): Promise<T> {
  const db = await initializeDatabase(config)
  await db.execute("BEGIN TRANSACTION")
  try {
    const result = await fn({ _tauriDb: db } as unknown as DrizzleDB)
    await db.execute("COMMIT")
    return result
  } catch (error) {
    await db.execute("ROLLBACK")
    throw error
  }
}
```


the sync engine
---

Sync is the hardest part of offline-first. The desktop app needs to:

1. Pull remote changes since the last sync
2. Push local mutations created while offline
3. Detect and resolve conflicts when the same record was edited on both sides
4. Preserve causal ordering (if edit B depends on edit A, they must apply in order)

The implementation uses vector clocks for causal ordering and last-write-wins for conflict resolution. Here's the conceptual model:

**Vector clocks.** Each device maintains a map of `{ deviceId: counter }`. When a device makes a change, it increments its counter. The vector clock gets attached to every mutation. When comparing two versions of a record, the clocks tell you whether one causally precedes the other (all counters <=) or whether they're concurrent (neither dominates).

**Conflict resolution.** If clocks show concurrent edits (true conflict), we use last-write-wins based on timestamp. This is a deliberate choice--it's simple and predictable, though it can lose data. Alternatives like operational transformation or CRDTs are more correct but significantly more complex. For a project management tool where edits are mostly to different fields, last-write-wins is usually fine.

**Mutation queue.** Local mutations go into a queue table before being applied to the local database. The queue persists to localStorage as a backup--if the app crashes or is force-closed mid-sync, mutations aren't lost. On restart, the queue is restored and sync resumes.

**Tombstones.** Deletions are tricky. If device A deletes a record and device B edits it offline, we need to know the deletion happened. The solution is tombstones--when a record is deleted, we keep a marker with its ID and the deletion timestamp. Delta sync includes tombstones, and the receiver respects them.

The sync tables are defined in `src/lib/sync/schema.ts`:

```typescript
export const localSyncMetadata = sqliteTable("local_sync_metadata", {
  tableName: text("table_name").notNull(),
  recordId: text("record_id").notNull(),
  vectorClock: text("vector_clock").notNull(),
  lastSyncedAt: text("last_synced_at"),
  isDeleted: integer("is_deleted", { mode: "boolean" }).default(false),
})

export const mutationQueue = sqliteTable("mutation_queue", {
  id: text("id").primaryKey(),
  operation: text("operation", { enum: ["insert", "update", "delete"] }).notNull(),
  tableName: text("table_name").notNull(),
  recordId: text("record_id").notNull(),
  payload: text("payload"),
  vectorClock: text("vector_clock").notNull(),
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull(),
  retryCount: integer("retry_count").default(0),
  processAfter: text("process_after"),  // For non-blocking backoff
})
```


the beforeunload problem
---

A user with pending mutations could close the app before sync completes. The mutations would be lost even though they're in the queue--the queue is persisted, but the user might not reopen the app.

The solution is a `beforeunload` handler that warns the user:

```typescript
useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (pendingCount > 0 || isSyncing) {
      e.preventDefault()
      e.returnValue = "Sync in progress. Close anyway?"
    }
  }
  window.addEventListener("beforeunload", handleBeforeUnload)
  return () => window.removeEventListener("beforeunload", handleBeforeUnload)
}, [pendingCount, isSyncing])
```

This is implemented in `src/components/desktop/desktop-shell.tsx`. The handler only triggers when there's actual pending work--closing the app with a clean sync state is silent.


linux compatibility
---

Linux desktop support is where Tauri's WebKitGTK backend causes problems. The issue is specific to NVIDIA GPUs on Wayland: WebKitGTK's DMA-BUF renderer conflicts with NVIDIA's driver implementation, causing crashes or extreme slowness.

The fix depends on driver version:

- **NVIDIA 545+**: `__NV_DISABLE_EXPLICIT_SYNC=1` disables the new explicit sync protocol. This is the preferred fix--it maintains hardware acceleration.

- **Older drivers**: `WEBKIT_DISABLE_DMABUF_RENDERER=1` forces software rendering. This is stable but slow.

The app detects the configuration at startup in `lib.rs`:

```rust
#[cfg(target_os = "linux")]
{
    let session_type = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    let is_wayland = session_type == "wayland";
    let has_nvidia = std::path::Path::new("/proc/driver/nvidia").exists();

    if is_wayland && has_nvidia {
        if std::env::var("__NV_DISABLE_EXPLICIT_SYNC").is_err() {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }
    }
}
```

We only set the explicit sync flag automatically. The DMABUF fallback (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) forces software rendering which is noticeably slower--if a user needs it, they can set it manually. The automatic fix works for most modern setups; the manual fallback exists for edge cases.

Wayland compositors also handle window decorations differently from X11. The app detects Wayland and disables CSD (client-side decorations):

```rust
if is_wayland {
    let _ = window.set_decorations(false);
}
```

This prevents duplicate title bars on compositors like Hyprland or Sway that draw their own decorations.


security model
---

Tauri uses a capability-based security model. The `src-tauri/capabilities/default.json` file defines what the frontend can access:

**HTTP permissions.** Fetch requests are scoped to specific domains:

```json
{
  "identifier": "http:default",
  "allow": [
    { "url": "http://localhost:*" },
    { "url": "http://127.0.0.1:*" },
    { "url": "https://compass.work/**" },
    { "url": "https://*.cloudflare.com/**" },
    { "url": "https://api.openrouter.ai/**" },
    { "url": "https://api.workos.com/**" }
  ]
}
```

The localhost entries are needed for dev mode (the frontend talks to `localhost:3000`). Production domains include the app itself, the Cloudflare deployment platform, and the AI/auth providers.

**Filesystem permissions.** Access is limited to app-specific directories:

```json
{
  "identifier": "fs:default",
  "allow": [
    { "path": "$APPDATA/**" },
    { "path": "$APPCONFIG/**" },
    { "path": "$LOCALDATA/**" }
  ]
}
```

The SQLite database lives in `$APPDATA/compass/`. The app can't read or write outside these directories.

**Content Security Policy.** Configured in `tauri.conf.json`:

```
default-src 'self'
script-src 'self' 'unsafe-inline' 'unsafe-eval'
connect-src 'self' http://localhost:* https: wss:
```

The `unsafe-inline` and `unsafe-eval` are required for Next.js--the Turbopack dev server uses inline scripts and eval for hot module replacement. In a production build, these could potentially be removed, but dev mode needs them.


troubleshooting
---

**Blank window on Linux.** If the window opens but shows nothing:

1. Check that the dev server is running (`http://localhost:3000` responds)
2. Check HTTP permissions include `localhost:*` in capabilities
3. Check CSP allows `connect-src 'self' http://localhost:*`

**Crash on Wayland + NVIDIA.** The automatic fix should handle most cases. If it still crashes:

```bash
# Force software rendering (stable but slow)
WEBKIT_DISABLE_DMABUF_RENDERER=1 bun tauri:dev

# Or use X11 backend
GDK_BACKEND=x11 bun tauri:dev
```

**Slow performance in dev mode.** Dev mode is inherently slower than production:
- Turbopack compiles routes on first access (1-3s per route)
- Cloudflare bindings go through a wrangler proxy
- If DMABUF is disabled, rendering is software-only

Production builds don't have these issues. The desktop app built with `bun tauri:build` is significantly snappier.


commands
---

```bash
bun tauri:dev      # Development with hot reload
bun tauri:build    # Production build (creates installer)
bun tauri:preview  # Run built app without rebuilding
```

No environment variables needed--the app handles platform detection and applies fixes automatically.
