// Window state persistence using the Electron desktop bridge.
// Saves and restores window position, size, and state across sessions

import { isElectron } from "@/lib/native/platform"

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
  isFullscreen: boolean
}

const WINDOW_STATE_KEY = "compass-window-state"
const ZOOM_LEVEL_KEY = "compass-zoom-level"

// Internal state cache
let cachedState: WindowState | null = null

async function loadWindowStateFromStore(): Promise<WindowState | null> {
  if (!isElectron()) return null

  try {
    return await window.compassDesktop!.window.getState()
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
  async restoreState(): Promise<void> {
    if (!isElectron()) return

    try {
      cachedState = await loadWindowStateFromStore()
      await this.restoreZoom()
    } catch (error) {
      console.error("Failed to restore window state:", error)
    }
  },

  // Save current window state
  async saveState(): Promise<void> {
    if (!isElectron()) return

    try {
      const state = await loadWindowStateFromStore()
      if (state) {
        cachedState = state
        saveToLocalStorage(state)
      }

      await window.compassDesktop!.window.saveState()
    } catch (error) {
      console.error("Failed to save window state:", error)
    }
  },

  // Get cached window state without crossing the desktop bridge.
  getCachedState(): WindowState | null {
    return cachedState ?? loadFromLocalStorage()
  },

  // Minimize window
  async minimize(): Promise<void> {
    if (!isElectron()) return

    try {
      await window.compassDesktop!.window.minimize()
    } catch (error) {
      console.error("Failed to minimize window:", error)
    }
  },

  // Toggle maximize
  async toggleMaximize(): Promise<void> {
    if (!isElectron()) return

    try {
      await window.compassDesktop!.window.toggleMaximize()
    } catch (error) {
      console.error("Failed to toggle maximize:", error)
    }
  },

  // Close window
  async close(): Promise<void> {
    if (!isElectron()) return

    try {
      await window.compassDesktop!.window.close()
    } catch (error) {
      console.error("Failed to close window:", error)
    }
  },

  // Set window title
  async setTitle(title: string): Promise<void> {
    if (!isElectron()) return

    try {
      await window.compassDesktop!.window.setTitle(title)
    } catch (error) {
      console.error("Failed to set window title:", error)
    }
  },

  // Check if window is focused
  async isFocused(): Promise<boolean> {
    if (!isElectron()) return true

    try {
      return await window.compassDesktop!.window.isFocused()
    } catch {
      return true
    }
  },

  // Set webview zoom via Electron native API with CSS font-size fallback
  async setZoom(level: number): Promise<void> {
    const clamped = Math.min(2.0, Math.max(0.5, level))
    try {
      localStorage.setItem(ZOOM_LEVEL_KEY, String(clamped))
    } catch {
      // localStorage not available
    }
    try {
      await window.compassDesktop?.window.setZoom(clamped)
      document.documentElement.style.fontSize = ""
    } catch {
      document.documentElement.style.fontSize = `${clamped * 16}px`
    }
  },

  // Get stored zoom level (defaults to 1.0)
  getZoom(): number {
    try {
      const stored = localStorage.getItem(ZOOM_LEVEL_KEY)
      if (stored) {
        const level = parseFloat(stored)
        if (!isNaN(level) && level >= 0.5 && level <= 2.0) return level
      }
    } catch {
      // localStorage not available
    }
    return 1.0
  },

  // Restore zoom from stored level
  async restoreZoom(): Promise<void> {
    const level = this.getZoom()
    if (level !== 1.0) {
      await this.setZoom(level)
    }
  },
}
