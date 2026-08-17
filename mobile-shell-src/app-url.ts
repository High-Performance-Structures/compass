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
