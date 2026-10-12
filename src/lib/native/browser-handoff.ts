// The iOS and Android apps claim https links under /dashboard/, so opening a
// dashboard URL from inside the app would route straight back into the app.
// The handoff goes through /open, which neither app claims, and the server then
// redirects to the requested page inside the phone's browser.

const DEFAULT_DESTINATION = "/dashboard"

/** Returns a same-origin path, or the dashboard when the value is unsafe. */
export function safeBrowserDestination(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_DESTINATION
  }
  try {
    const parsed = new URL(value, "https://compass.invalid")
    if (parsed.origin !== "https://compass.invalid") return DEFAULT_DESTINATION
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return DEFAULT_DESTINATION
  }
}

export function browserHandoffUrl(origin: string, destination: string): string {
  const url = new URL("/open", origin)
  url.searchParams.set("to", safeBrowserDestination(destination))
  return url.toString()
}
