/**
 * A photo source sized for printing: Drive photos come through Drive's
 * thumbnail service at print size instead of as the full original, which
 * keeps photo-heavy PDFs small enough to render.
 */
export function printImageSrc(src: string): string {
  if (!src.startsWith("/api/google/download/")) return src
  return `${src}${src.includes("?") ? "&" : "?"}size=print`
}
