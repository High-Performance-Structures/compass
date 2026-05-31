// Desktop utilities for Electron apps
// All exports are safe to use on web (no-ops or returns null)

export {
  WindowManager,
  type WindowState,
} from "./window-manager"

export {
  registerShortcuts,
  unregisterShortcut,
  isShortcutRegistered,
  SHORTCUTS,
  type ShortcutHandlers,
} from "./shortcuts"
