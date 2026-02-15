// Safe platform detection for Capacitor native apps and Tauri desktop.
// All exports are safe to call in browser (return false / no-op).

type CapacitorGlobal = {
  readonly isNative: boolean
  getPlatform: () => string
}

function getCapacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as Record<string, unknown>)
    .Capacitor as CapacitorGlobal | undefined
}

// Tauri injects __TAURI__ global when running in desktop app
function getTauriGlobal(): Record<string, unknown> | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as Record<string, unknown>).__TAURI__ as
    | Record<string, unknown>
    | undefined
}

export function isNative(): boolean {
  return getCapacitor()?.isNative ?? false
}

export function isIOS(): boolean {
  return getCapacitor()?.getPlatform() === "ios"
}

export function isAndroid(): boolean {
  return getCapacitor()?.getPlatform() === "android"
}

export function isTauri(): boolean {
  return !!getTauriGlobal()
}

export function isDesktop(): boolean {
  return isTauri()
}

export type Platform = "ios" | "android" | "windows" | "macos" | "linux" | "web"

// Detect OS platform when running in Tauri desktop
function detectDesktopOS(): "windows" | "macos" | "linux" {
  if (typeof navigator === "undefined") return "linux"

  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("win")) return "windows"
  if (ua.includes("mac")) return "macos"
  return "linux"
}

export function getPlatform(): Platform {
  // Check Tauri desktop first
  if (isTauri()) {
    return detectDesktopOS()
  }
  // Then check Capacitor mobile
  const cap = getCapacitor()
  if (cap?.isNative) {
    const p = cap.getPlatform()
    if (p === "ios") return "ios"
    if (p === "android") return "android"
  }
  return "web"
}

// Legacy function for backward compatibility
export function getMobilePlatform(): "ios" | "android" | "web" {
  const cap = getCapacitor()
  if (!cap?.isNative) return "web"
  const p = cap.getPlatform()
  if (p === "ios") return "ios"
  if (p === "android") return "android"
  return "web"
}

// Returns true for any native platform (Capacitor mobile or Tauri desktop)
export function isAnyNative(): boolean {
  return isNative() || isTauri()
}
