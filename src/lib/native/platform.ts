// Safe platform detection for Capacitor native apps and Electron desktop.
// All exports are safe to call in browser (return false / no-op).

type CapacitorGlobal = {
  readonly isNativePlatform: () => boolean
  readonly getPlatform: () => string
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
  return getCapacitor()?.isNativePlatform() ?? false
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
export type MobilePlatform = "ios" | "android" | "web"
const NATIVE_PLATFORM_SESSION_KEY = "compass_native_platform"

function isMobilePlatform(value: string | null | undefined): value is Exclude<MobilePlatform, "web"> {
  return value === "ios" || value === "android"
}

export function resolveMobilePlatform(
  capacitorPlatform: string | null | undefined,
  hintedPlatform: string | null | undefined,
  storedPlatform: string | null | undefined,
  browserPlatform: string | null | undefined = undefined,
): MobilePlatform {
  if (isMobilePlatform(capacitorPlatform)) return capacitorPlatform
  if (isMobilePlatform(hintedPlatform)) return hintedPlatform
  if (isMobilePlatform(storedPlatform)) return storedPlatform
  if (isMobilePlatform(browserPlatform)) return browserPlatform
  return "web"
}

export function inferMobileBrowserPlatform(
  userAgent: string,
  navigatorPlatform?: string,
  maxTouchPoints = 0,
): MobilePlatform {
  const normalizedUserAgent = userAgent.toLowerCase()
  if (normalizedUserAgent.includes("android")) return "android"
  if (/iphone|ipad|ipod/.test(normalizedUserAgent)) return "ios"

  // Modern iPadOS can identify itself as macOS in Safari.
  if (navigatorPlatform === "MacIntel" && maxTouchPoints > 1) return "ios"
  return "web"
}

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
  if (cap?.isNativePlatform()) {
    const p = cap.getPlatform()
    if (p === "ios") return "ios"
    if (p === "android") return "android"
  }
  return "web"
}

// Legacy function for backward compatibility
export function getMobilePlatform(): MobilePlatform {
  const cap = getCapacitor()
  const capacitorPlatform = cap?.isNativePlatform()
    ? cap.getPlatform()
    : undefined

  if (typeof window === "undefined") {
    return resolveMobilePlatform(capacitorPlatform, null, null)
  }
  const hintedPlatform = new URLSearchParams(window.location.search).get(
    "nativePlatform"
  )
  if (isMobilePlatform(hintedPlatform)) {
    try {
      window.sessionStorage.setItem(
        NATIVE_PLATFORM_SESSION_KEY,
        hintedPlatform
      )
    } catch {
      // Session storage can be unavailable in hardened WebViews.
    }
  }

  let storedPlatform: string | null = null
  try {
    storedPlatform = window.sessionStorage.getItem(
      NATIVE_PLATFORM_SESSION_KEY
    )
  } catch {
    // Fall back to web when storage is unavailable.
  }
  const browserPlatform = inferMobileBrowserPlatform(
    window.navigator.userAgent,
    window.navigator.platform,
    window.navigator.maxTouchPoints,
  )
  return resolveMobilePlatform(
    capacitorPlatform,
    hintedPlatform,
    storedPlatform,
    browserPlatform,
  )
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
