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

// Open an external URL in the system browser.
// On Tauri desktop, uses the opener plugin to open in the default browser.
// On web, opens in a new window/tab.
export async function openExternalUrl(
  url: string,
  options?: {
    windowName?: string
    windowFeatures?: string
  },
): Promise<boolean> {
  // On Tauri desktop, use opener plugin to open in system browser
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener")
      await openUrl(url)
      return true
    } catch (error) {
      console.error("Failed to open URL via Tauri opener:", error)
      // Fallback to window.open (may not work in some Tauri configs)
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
