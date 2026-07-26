export function sameOriginNavigationHref(
  href: string,
  currentOrigin: string
): string | null {
  try {
    const url = new URL(href, currentOrigin)
    if (
      url.origin !== currentOrigin ||
      (url.protocol !== "http:" && url.protocol !== "https:")
    ) {
      return null
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}
