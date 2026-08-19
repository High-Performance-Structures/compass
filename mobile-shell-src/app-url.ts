export function resolveDashboardAppUrl(
  appUrl: string,
  liveOrigin: string,
): string | undefined {
  let url: URL
  try {
    url = new URL(appUrl)
  } catch {
    return undefined
  }

  if (
    url.protocol !== "https:" ||
    url.origin !== liveOrigin ||
    !url.pathname.startsWith("/dashboard/")
  ) {
    return undefined
  }

  return `${liveOrigin}${url.pathname}${url.search}${url.hash}`
}

export function isFieldAppUrl(appUrl: string): boolean {
  try {
    const url = new URL(appUrl)
    return url.protocol === "compass:" && url.hostname === "field"
  } catch {
    return false
  }
}
