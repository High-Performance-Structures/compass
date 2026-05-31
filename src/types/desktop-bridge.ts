export type DesktopPlatform = "windows" | "macos" | "linux"

export type DesktopReadyState = "loading" | "ready" | "error"

export interface DesktopWindowState {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly isMaximized: boolean
  readonly isFullscreen: boolean
}

export interface DesktopSyncState {
  readonly status: "idle" | "syncing" | "error" | "offline"
  readonly pendingCount: number
  readonly lastSyncTime: number | null
  readonly errorMessage: string | null
}

export interface DesktopClaudeCredentialsStatus {
  readonly hasCredentials: boolean
  readonly expiresAt: number
  readonly subscriptionType?: string
}

export interface DesktopShortcutHandlers {
  readonly sync?: () => void
  readonly new?: () => void
  readonly search?: () => void
  readonly settings?: () => void
  readonly zoomIn?: () => void
  readonly zoomOut?: () => void
  readonly zoomReset?: () => void
}

export interface CompassDesktopBridge {
  readonly platform: {
    readonly os: DesktopPlatform
    readonly isDesktop: true
  }
  readonly window: {
    readonly getState: () => Promise<DesktopWindowState | null>
    readonly saveState: () => Promise<void>
    readonly minimize: () => Promise<void>
    readonly toggleMaximize: () => Promise<void>
    readonly close: () => Promise<void>
    readonly setTitle: (title: string) => Promise<void>
    readonly isFocused: () => Promise<boolean>
    readonly setZoom: (level: number) => Promise<void>
  }
  readonly shortcuts: {
    readonly register: (shortcuts: readonly string[]) => Promise<void>
    readonly unregisterAll: () => Promise<void>
    readonly isRegistered: (shortcut: string) => Promise<boolean>
    readonly onPressed: (handler: (shortcut: string) => void) => () => void
  }
  readonly sync: {
    readonly trigger: () => Promise<boolean>
    readonly onStatus: (handler: (state: DesktopSyncState) => void) => () => void
    readonly onQueueChanged: (handler: (payload: { readonly count: number }) => void) => () => void
  }
  readonly fs: {
    readonly detectClaudeCodeCredentials: () => Promise<DesktopClaudeCredentialsStatus | null>
  }
  readonly shell: {
    readonly openExternal: (url: string) => Promise<boolean>
  }
  readonly updater: {
    readonly check: () => Promise<void>
  }
}

declare global {
  interface Window {
    readonly compassDesktop?: CompassDesktopBridge
  }
}
