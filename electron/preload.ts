import { contextBridge, ipcRenderer } from "electron"
import type {
  CompassDesktopBridge,
  DesktopSyncState,
  DesktopWindowState,
  DesktopClaudeCredentialsStatus,
} from "../src/types/desktop-bridge"

function onChannel<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => {
    handler(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const bridge: CompassDesktopBridge = {
  platform: {
    os:
      process.platform === "darwin"
        ? "macos"
        : process.platform === "win32"
          ? "windows"
          : "linux",
    isDesktop: true,
  },
  window: {
    getState: () => ipcRenderer.invoke("desktop:window:get-state") as Promise<DesktopWindowState | null>,
    saveState: () => ipcRenderer.invoke("desktop:window:save-state") as Promise<void>,
    minimize: () => ipcRenderer.invoke("desktop:window:minimize") as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke("desktop:window:toggle-maximize") as Promise<void>,
    close: () => ipcRenderer.invoke("desktop:window:close") as Promise<void>,
    setTitle: (title) => ipcRenderer.invoke("desktop:window:set-title", title) as Promise<void>,
    isFocused: () => ipcRenderer.invoke("desktop:window:is-focused") as Promise<boolean>,
    setZoom: (level) => ipcRenderer.invoke("desktop:window:set-zoom", level) as Promise<void>,
  },
  shortcuts: {
    register: (shortcuts) => ipcRenderer.invoke("desktop:shortcuts:register", shortcuts) as Promise<void>,
    unregisterAll: () => ipcRenderer.invoke("desktop:shortcuts:unregister-all") as Promise<void>,
    isRegistered: (shortcut) => ipcRenderer.invoke("desktop:shortcuts:is-registered", shortcut) as Promise<boolean>,
    onPressed: (handler) => onChannel<string>("desktop:shortcut-pressed", handler),
  },
  sync: {
    trigger: () => ipcRenderer.invoke("desktop:sync:trigger") as Promise<boolean>,
    onStatus: (handler) => onChannel<DesktopSyncState>("sync:status", handler),
    onQueueChanged: (handler) => onChannel<{ readonly count: number }>("sync:queue-changed", handler),
  },
  fs: {
    detectClaudeCodeCredentials: () =>
      ipcRenderer.invoke("desktop:fs:detect-claude-code-credentials") as Promise<DesktopClaudeCredentialsStatus | null>,
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke("desktop:shell:open-external", url) as Promise<boolean>,
  },
  updater: {
    check: () => ipcRenderer.invoke("desktop:updater:check") as Promise<void>,
  },
}

contextBridge.exposeInMainWorld("compassDesktop", bridge)
