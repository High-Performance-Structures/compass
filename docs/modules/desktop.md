Desktop Module
===

The desktop module wraps Compass in an Electron app for Windows, macOS, and Linux. The packaged desktop app loads the hosted Compass web app so authentication, server actions, and data access continue to run on the existing Cloudflare/OpenNext runtime.

The web app still treats desktop as a platform capability, not a fork. Browser and mobile runtimes do not import Electron modules. Desktop-only features are exposed through a narrow preload bridge at `window.compassDesktop`.


architecture
---

```text
electron/
├── main.ts       # app lifecycle, hosted/development app loading, IPC, shortcuts
├── preload.ts    # contextBridge API exposed to the renderer
└── tsconfig.json # compiles Electron files to dist-electron/

src/
├── types/desktop-bridge.ts       # typed preload API
├── db/provider/electron-provider.ts
├── hooks/use-desktop.ts
├── hooks/use-sync-status.ts
├── lib/desktop/
└── components/desktop/
```

The main process owns Node-only capabilities: filesystem credential detection, shell integration, global shortcuts, updates, and window controls. The renderer can only reach those features through typed IPC methods exposed by the preload script.


runtime model
---

Development loads the normal Next dev server:

```bash
bun run desktop:dev
```

Production packages the app with `electron-builder`:

```bash
bun run desktop:pack
bun run desktop:dist
```

The packaged app loads the hosted Compass URL. This keeps WorkOS authentication and Cloudflare bindings on the same runtime used by the web deployment. The non-packaged fallback can still start a local Next server for development and smoke testing.


security model
---

Electron is configured with:

- `nodeIntegration: false`
- `contextIsolation: true`
- a preload-only desktop API
- denied arbitrary popup windows
- navigation limited to the Compass app origin plus explicit hosted auth origins
- main-process validation for IPC inputs

Do not expose raw `ipcRenderer`, filesystem paths, shell execution, or database handles to the renderer.


local data and sync
---

The Electron bridge does not expose raw SQL or a local database handle. Data access continues through the hosted app's server actions and API routes.

The existing local mutation queue backup remains in localStorage so pending changes can survive reloads or a forced close. The hosted Electron runtime does not claim successful local sync from the main process; sync status events are reserved for a real queue processor when offline desktop sync is implemented.

- `sync:status`
- `sync:queue-changed`


commands
---

```bash
bun run desktop:compile # compile Electron main/preload files
bun run desktop:dev     # run Next dev server and Electron
bun run desktop:build   # build Next and compile Electron
bun run desktop:pack    # unpacked local Electron build
bun run desktop:dist    # distributable installers/packages
```
