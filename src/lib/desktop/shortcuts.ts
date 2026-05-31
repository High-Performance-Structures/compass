// Global keyboard shortcuts using the Electron desktop bridge.
// Desktop-only: provides common shortcuts like Cmd/Ctrl+S for sync

import { isElectron } from "@/lib/native/platform"

export interface ShortcutHandlers {
  triggerSync: () => Promise<boolean>
  onNew?: () => void
  onSearch?: () => void
  onSettings?: () => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onZoomReset?: () => void
}

interface RegisteredShortcut {
  id: string
  handler: () => void
}

const registeredShortcuts: RegisteredShortcut[] = []

// Platform-specific modifier key
function getModifierKey(): "CommandOrControl" | "Ctrl" {
  if (typeof navigator === "undefined") return "CommandOrControl"
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
  return isMac ? "CommandOrControl" : "Ctrl"
}

export async function registerShortcuts(
  handlers: ShortcutHandlers,
): Promise<() => void> {
  if (!isElectron() || !window.compassDesktop) return () => {}

  try {
    const modifier = getModifierKey()

    const shortcuts: Array<{ shortcut: string; handler: () => void }> = [
      // Sync: Cmd/Ctrl + S
      {
        shortcut: `${modifier}+S`,
        handler: async () => {
          await handlers.triggerSync()
        },
      },
      // New item: Cmd/Ctrl + N
      ...(handlers.onNew
        ? [{ shortcut: `${modifier}+N`, handler: handlers.onNew }]
        : []),
      // Search: Cmd/Ctrl + K
      ...(handlers.onSearch
        ? [{ shortcut: `${modifier}+K`, handler: handlers.onSearch }]
        : []),
      // Settings: Cmd/Ctrl + ,
      ...(handlers.onSettings
        ? [{ shortcut: `${modifier}+,`, handler: handlers.onSettings }]
        : []),
      // Zoom in: Cmd/Ctrl + =
      ...(handlers.onZoomIn
        ? [{ shortcut: `${modifier}+=`, handler: handlers.onZoomIn }]
        : []),
      // Zoom out: Cmd/Ctrl + -
      ...(handlers.onZoomOut
        ? [{ shortcut: `${modifier}+-`, handler: handlers.onZoomOut }]
        : []),
      // Zoom reset: Cmd/Ctrl + 0
      ...(handlers.onZoomReset
        ? [{ shortcut: `${modifier}+0`, handler: handlers.onZoomReset }]
        : []),
    ]

    const byShortcut = new Map(shortcuts.map(({ shortcut, handler }) => [shortcut, handler]))
    const unlisten = window.compassDesktop.shortcuts.onPressed((shortcut) => {
      byShortcut.get(shortcut)?.()
    })

    await window.compassDesktop.shortcuts.register(shortcuts.map(({ shortcut }) => shortcut))
    registeredShortcuts.push(...shortcuts.map(({ shortcut, handler }) => ({ id: shortcut, handler })))

    return async () => {
      unlisten()
      await window.compassDesktop?.shortcuts.unregisterAll()
      registeredShortcuts.length = 0
    }
  } catch (error) {
    console.error("Failed to set up global shortcuts:", error)
    return () => {}
  }
}

// Unregister a specific shortcut
export async function unregisterShortcut(shortcut: string): Promise<void> {
  if (!isElectron() || !window.compassDesktop) return

  try {
    await window.compassDesktop.shortcuts.unregisterAll()
    const index = registeredShortcuts.findIndex((s) => s.id === shortcut)
    if (index >= 0) {
      registeredShortcuts.splice(index, 1)
    }
  } catch (error) {
    console.error(`Failed to unregister shortcut ${shortcut}:`, error)
  }
}

// Check if a shortcut is registered
export async function isShortcutRegistered(
  shortcut: string,
): Promise<boolean> {
  if (!isElectron() || !window.compassDesktop) return false

  try {
    return await window.compassDesktop.shortcuts.isRegistered(shortcut)
  } catch {
    return false
  }
}

// Common shortcut definitions for UI display
export const SHORTCUTS = {
  sync: "Cmd/Ctrl + S",
  new: "Cmd/Ctrl + N",
  search: "Cmd/Ctrl + K",
  settings: "Cmd/Ctrl + ,",
  reload: "Cmd/Ctrl + R",
  devTools: "Cmd/Ctrl + Shift + I",
  quit: "Cmd/Ctrl + Q",
  zoomIn: "Cmd/Ctrl + =",
  zoomOut: "Cmd/Ctrl + -",
  zoomReset: "Cmd/Ctrl + 0",
} as const
