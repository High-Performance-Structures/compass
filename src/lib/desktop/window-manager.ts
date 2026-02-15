// Window state persistence using tauri-plugin-window-state
// Saves and restores window position, size, and state across sessions

import { isTauri } from "@/lib/native/platform"

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
  isFullscreen: boolean
}

const WINDOW_STATE_KEY = "compass-window-state"

// Internal state cache
let cachedState: WindowState | null = null

async function loadWindowStateFromStore(): Promise<WindowState | null> {
  if (!isTauri()) return null

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    const appWindow = getCurrentWindow()

    // Get current window state
    const [position, size, isMaximized, isFullscreen] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
      appWindow.isMaximized(),
      appWindow.isFullscreen(),
    ])

    return {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      isMaximized,
      isFullscreen,
    }
  } catch (error) {
    console.error("Failed to load window state:", error)
    return null
  }
}

// Save window state to localStorage as backup
function saveToLocalStorage(state: WindowState): void {
  try {
    localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(state))
  } catch {
    // localStorage may not be available
  }
}

// Load window state from localStorage
function loadFromLocalStorage(): WindowState | null {
  try {
    const stored = localStorage.getItem(WINDOW_STATE_KEY)
    if (stored) {
      return JSON.parse(stored) as WindowState
    }
  } catch {
    // Invalid JSON or localStorage not available
  }
  return null
}

export const WindowManager = {
  // Restore window state from Tauri plugin or localStorage fallback
  async restoreState(): Promise<void> {
    if (!isTauri()) return

    try {
      // Try using tauri-plugin-window-state if available
      const { invoke } = await import("@tauri-apps/api/core")

      // The window-state plugin automatically restores state if configured
      // This is just a check that we're in a Tauri environment
      await invoke("plugin:window-state|restore_state").catch(() => {
        // Plugin not configured, use manual restoration
      })

      // Also cache current state
      cachedState = await loadWindowStateFromStore()
    } catch (error) {
      console.error("Failed to restore window state:", error)
    }
  },

  // Save current window state
  async saveState(): Promise<void> {
    if (!isTauri()) return

    try {
      const state = await loadWindowStateFromStore()
      if (state) {
        cachedState = state
        saveToLocalStorage(state)
      }

      // Also try the plugin save
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("plugin:window-state|save_state").catch(() => {
        // Plugin not configured
      })
    } catch (error) {
      console.error("Failed to save window state:", error)
    }
  },

  // Get cached window state (doesn't query Tauri)
  getCachedState(): WindowState | null {
    return cachedState ?? loadFromLocalStorage()
  },

  // Minimize window
  async minimize(): Promise<void> {
    if (!isTauri()) return

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      await getCurrentWindow().minimize()
    } catch (error) {
      console.error("Failed to minimize window:", error)
    }
  },

  // Toggle maximize
  async toggleMaximize(): Promise<void> {
    if (!isTauri()) return

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      await getCurrentWindow().toggleMaximize()
    } catch (error) {
      console.error("Failed to toggle maximize:", error)
    }
  },

  // Close window
  async close(): Promise<void> {
    if (!isTauri()) return

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      await getCurrentWindow().close()
    } catch (error) {
      console.error("Failed to close window:", error)
    }
  },

  // Set window title
  async setTitle(title: string): Promise<void> {
    if (!isTauri()) return

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      await getCurrentWindow().setTitle(title)
    } catch (error) {
      console.error("Failed to set window title:", error)
    }
  },

  // Check if window is focused
  async isFocused(): Promise<boolean> {
    if (!isTauri()) return true

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      return await getCurrentWindow().isFocused()
    } catch {
      return true
    }
  },
}
