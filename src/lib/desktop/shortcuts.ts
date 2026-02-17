// Global keyboard shortcuts using tauri-plugin-global-shortcut
// Desktop-only: provides common shortcuts like Cmd/Ctrl+S for sync

import { isTauri } from "@/lib/native/platform"

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

// Register global shortcuts with Tauri
export async function registerShortcuts(
  handlers: ShortcutHandlers,
): Promise<() => void> {
  if (!isTauri()) return () => {}

  try {
    const { register, unregister } = await import(
      "@tauri-apps/plugin-global-shortcut"
    )
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

    // Register each shortcut
    for (const { shortcut, handler } of shortcuts) {
      try {
        await register(shortcut, () => handler())
        registeredShortcuts.push({ id: shortcut, handler })
      } catch (error) {
        console.warn(`Failed to register shortcut ${shortcut}:`, error)
      }
    }

    // Return unregister function
    return async () => {
      for (const { id } of registeredShortcuts) {
        try {
          await unregister(id)
        } catch {
          // Already unregistered or failed
        }
      }
      registeredShortcuts.length = 0
    }
  } catch (error) {
    console.error("Failed to set up global shortcuts:", error)
    return () => {}
  }
}

// Unregister a specific shortcut
export async function unregisterShortcut(shortcut: string): Promise<void> {
  if (!isTauri()) return

  try {
    const { unregister } = await import(
      "@tauri-apps/plugin-global-shortcut"
    )
    await unregister(shortcut)
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
  if (!isTauri()) return false

  try {
    const { isRegistered } = await import(
      "@tauri-apps/plugin-global-shortcut"
    )
    return await isRegistered(shortcut)
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
