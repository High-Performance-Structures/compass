// Server-side native app detection via User-Agent.
// Capacitor's WebView includes "CapacitorApp" in the UA string.

export function isNativeApp(request: Request): boolean {
  const ua = request.headers.get("user-agent") ?? ""
  return ua.includes("CapacitorApp")
}
