/**
 * A photo source sized for printing: Drive photos come through Drive's
 * thumbnail service at print size instead of as the full original, which
 * keeps photo-heavy PDFs small enough to render.
 */
export function printImageSrc(src: string): string {
  if (!src.startsWith("/api/google/download/") && !/^\/api\/projects\/[^/]+\/photos\/[^/?#]+(?:[?#]|$)/.test(src)) return src
  const url = new URL(src, "https://compass.invalid")
  url.searchParams.set("size", "print")
  return `${url.pathname}${url.search}${url.hash}`
}
