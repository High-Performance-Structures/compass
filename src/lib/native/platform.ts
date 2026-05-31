// Safe platform detection for Capacitor native apps and Electron desktop.
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

function getDesktopBridge(): Window["compassDesktop"] {
  if (typeof window === "undefined") return undefined
  return window.compassDesktop
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

export function isElectron(): boolean {
  return !!getDesktopBridge()
}

export function isDesktop(): boolean {
  return isElectron()
}

export type Platform = "ios" | "android" | "windows" | "macos" | "linux" | "web"

function detectDesktopOS(): "windows" | "macos" | "linux" {
  const desktop = getDesktopBridge()
  if (desktop) return desktop.platform.os

  if (typeof navigator === "undefined") return "linux"

  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("win")) return "windows"
  if (ua.includes("mac")) return "macos"
  return "linux"
}

export function getPlatform(): Platform {
  if (isElectron()) {
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

// Returns true for any native platform (Capacitor mobile or Electron desktop)
export function isAnyNative(): boolean {
  return isNative() || isElectron()
}

// Open an external URL in the system browser.
// On Electron desktop, uses the main process to open in the default browser.
// On web, opens in a new window/tab.
export async function openExternalUrl(
  url: string,
  options?: {
    windowName?: string
    windowFeatures?: string
  },
): Promise<boolean> {
  if (isElectron()) {
    try {
      return await window.compassDesktop!.shell.openExternal(url)
    } catch (error) {
      console.error("Failed to open URL via Electron shell:", error)
      const popup = window.open(url, options?.windowName ?? "_blank")
      return !!popup
    }
  }

  // On web/mobile, use standard window.open
  const popup = window.open(
    url,
    options?.windowName ?? "_blank",
    options?.windowFeatures ?? "noopener,noreferrer",
  )
  return !!popup
}
