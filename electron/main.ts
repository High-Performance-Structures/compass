import { existsSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { join } from "node:path"
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron"
import log from "electron-log"
import { autoUpdater } from "electron-updater"
import next from "next"
import type {
  DesktopSyncState,
  DesktopWindowState,
} from "../src/types/desktop-bridge"

let mainWindow: BrowserWindow | null = null
let nextServer: Server | null = null
let trustedAppOrigin: string | null = null
const PACKAGED_APP_URL = "https://compass.openrangeconstruction.ltd"
const AUTH_NAVIGATION_HOSTS = new Set([
  "api.workos.com",
  "authkit.workos.com",
  "accounts.google.com",
  "github.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
])

const syncState: DesktopSyncState = {
  status: "idle",
  pendingCount: 0,
  lastSyncTime: null,
  errorMessage: null,
}

function isValidSender(event: IpcMainInvokeEvent): boolean {
  if (!event.senderFrame) return false
  if (event.senderFrame !== mainWindow?.webContents.mainFrame) return false
  if (!trustedAppOrigin) return false

  try {
    return new URL(event.senderFrame.url).origin === trustedAppOrigin
  } catch {
    return false
  }
}

function requireValidSender(event: IpcMainInvokeEvent): void {
  if (!isValidSender(event)) {
    throw new Error("Rejected IPC call from untrusted sender")
  }
}

async function startNextServer(): Promise<string> {
  const devUrl = process.env.ELECTRON_DEV_SERVER_URL
  if (devUrl) return devUrl

  if (app.isPackaged) {
    return PACKAGED_APP_URL
  }

  const dir = process.cwd()
  const nextApp = next({ dev: false, dir })
  const handler = nextApp.getRequestHandler()

  await nextApp.prepare()

  return await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handler(req, res).catch((error: unknown) => {
        log.error("Next request failed", error)
        res.statusCode = 500
        res.end("Internal server error")
      })
    })

    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate local server port"))
        return
      }
      nextServer = server
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function getWindowState(window: BrowserWindow): DesktopWindowState {
  const bounds = window.getBounds()
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: window.isMaximized(),
    isFullscreen: window.isFullScreen(),
  }
}

async function createMainWindow(): Promise<void> {
  const preload = join(__dirname, "preload.js")
  const appUrl = await startNextServer()
  trustedAppOrigin = new URL(appUrl).origin

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Compass",
    show: false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAppNavigationUrl(url) || isAllowedAuthNavigationUrl(url)) {
      return { action: "allow" }
    }
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url).catch((error: unknown) => log.error(error))
    }
    return { action: "deny" }
  })

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppNavigationUrl(url) && !isAllowedAuthNavigationUrl(url)) {
      event.preventDefault()
    }
  })

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show()
  })

  await mainWindow.loadURL(appUrl)
}

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "mailto:"
  } catch {
    return false
  }
}

function isAllowedAppNavigationUrl(url: string): boolean {
  if (!trustedAppOrigin) return false

  try {
    const parsed = new URL(url)
    return parsed.origin === trustedAppOrigin
  } catch {
    return false
  }
}

function isAllowedAuthNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false
    return AUTH_NAVIGATION_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

function sendSyncState(update: Partial<DesktopSyncState>): void {
  Object.assign(syncState, update)
  mainWindow?.webContents.send("sync:status", syncState)
  mainWindow?.webContents.send("sync:queue-changed", {
    count: syncState.pendingCount,
  })
}

function registerIpc(): void {
  ipcMain.handle("desktop:window:get-state", (event) => {
    requireValidSender(event)
    return mainWindow ? getWindowState(mainWindow) : null
  })

  ipcMain.handle("desktop:window:save-state", (event) => {
    requireValidSender(event)
  })

  ipcMain.handle("desktop:window:minimize", (event) => {
    requireValidSender(event)
    mainWindow?.minimize()
  })

  ipcMain.handle("desktop:window:toggle-maximize", (event) => {
    requireValidSender(event)
    if (!mainWindow) return
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.handle("desktop:window:close", (event) => {
    requireValidSender(event)
    mainWindow?.close()
  })

  ipcMain.handle("desktop:window:set-title", (event, title: unknown) => {
    requireValidSender(event)
    if (typeof title !== "string") throw new Error("Title must be a string")
    mainWindow?.setTitle(title)
  })

  ipcMain.handle("desktop:window:is-focused", (event) => {
    requireValidSender(event)
    return mainWindow?.isFocused() ?? true
  })

  ipcMain.handle("desktop:window:set-zoom", (event, level: unknown) => {
    requireValidSender(event)
    if (typeof level !== "number" || !Number.isFinite(level)) {
      throw new Error("Zoom level must be a finite number")
    }
    const clamped = Math.min(2, Math.max(0.5, level))
    mainWindow?.webContents.setZoomFactor(clamped)
  })

  ipcMain.handle("desktop:shortcuts:register", (event, shortcuts: unknown) => {
    requireValidSender(event)
    if (!Array.isArray(shortcuts)) throw new Error("Shortcuts must be an array")
    globalShortcut.unregisterAll()
    for (const shortcut of shortcuts) {
      if (typeof shortcut !== "string") continue
      globalShortcut.register(shortcut, () => {
        mainWindow?.webContents.send("desktop:shortcut-pressed", shortcut)
      })
    }
  })

  ipcMain.handle("desktop:shortcuts:unregister-all", (event) => {
    requireValidSender(event)
    globalShortcut.unregisterAll()
  })

  ipcMain.handle("desktop:shortcuts:is-registered", (event, shortcut: unknown) => {
    requireValidSender(event)
    if (typeof shortcut !== "string") return false
    return globalShortcut.isRegistered(shortcut)
  })

  ipcMain.handle("desktop:sync:trigger", (event) => {
    requireValidSender(event)
    sendSyncState({
      status: "error",
      errorMessage:
        "Desktop sync is unavailable in the hosted Electron runtime.",
    })
    return false
  })

  ipcMain.handle("desktop:fs:detect-claude-code-credentials", (event) => {
    requireValidSender(event)
    const credentialsPath = join(app.getPath("home"), ".claude", ".credentials.json")
    if (!existsSync(credentialsPath)) return null

    const parsed = JSON.parse(readFileSync(credentialsPath, "utf8"))
    const oauth = parsed?.claudeAiOauth
    if (
      !oauth ||
      typeof oauth.accessToken !== "string" ||
      typeof oauth.refreshToken !== "string" ||
      typeof oauth.expiresAt !== "number"
    ) {
      return null
    }

    return {
      hasCredentials: true,
      expiresAt: oauth.expiresAt,
      subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : undefined,
    }
  })

  ipcMain.handle("desktop:shell:open-external", async (event, url: unknown) => {
    requireValidSender(event)
    if (typeof url !== "string" || !isAllowedExternalUrl(url)) return false
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle("desktop:updater:check", async (event) => {
    requireValidSender(event)
    if (!app.isPackaged) return
    await autoUpdater.checkForUpdatesAndNotify()
  })
}

async function ensureUserDataDir(): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  globalShortcut.unregisterAll()
  nextServer?.close()
})

app.whenReady()
  .then(async () => {
    log.initialize()
    await ensureUserDataDir()
    registerIpc()
    await createMainWindow()
    autoUpdater.logger = log
  })
  .catch((error: unknown) => {
    log.error("Failed to start Compass desktop", error)
    app.quit()
  })

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch((error: unknown) => log.error(error))
  }
})
