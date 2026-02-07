// Safe platform detection for Capacitor native apps.
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

export function isNative(): boolean {
  return getCapacitor()?.isNative ?? false
}

export function isIOS(): boolean {
  return getCapacitor()?.getPlatform() === "ios"
}

export function isAndroid(): boolean {
  return getCapacitor()?.getPlatform() === "android"
}

export function getPlatform(): "ios" | "android" | "web" {
  const cap = getCapacitor()
  if (!cap?.isNative) return "web"
  const p = cap.getPlatform()
  if (p === "ios") return "ios"
  if (p === "android") return "android"
  return "web"
}
