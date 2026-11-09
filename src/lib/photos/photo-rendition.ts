/**
 * Photo renditions: which size of a photo a page asks the server for.
 *
 * Why grids use thumbnails: galleries, daily-log strips, dashboards and photo
 * pickers show dozens or hundreds of photos at once. When every tile asked for
 * the full-size original, the server streamed each multi-megabyte camera file
 * from Google Drive at the same time. On 2026-11-09 opening one ~150-photo
 * project gallery did exactly that and ran a Cloudflare worker out of memory
 * (requests failed with 503s). So:
 *
 * - Small views (grids, strips, lists, film strips) add `?size=thumb`. The
 *   photo routes answer with a ~400 px copy from Drive's thumbnail service,
 *   usually 20-60 KB instead of 2-8 MB.
 * - Printed documents add `?size=print` (an 800 px copy).
 * - The large viewer (lightbox), "Open" links and downloads use the plain URL,
 *   which streams the original.
 *
 * If Drive has no thumbnail for a file (not an image, or still processing) the
 * routes fall back to the original, so asking for a rendition is always safe.
 */

export type PhotoRendition = "thumb" | "print"

/** Longest side, in pixels, of each rendition. */
export const PHOTO_RENDITION_LONGEST_SIDE_PX: Readonly<Record<PhotoRendition, number>> = {
  thumb: 400,
  print: 800,
}

/** The rendition named by a `size` query value, or null for the original. */
export function photoRenditionFromSizeParam(value: string | null): PhotoRendition | null {
  if (value === "thumb" || value === "print") return value
  return null
}

const PROJECT_PHOTO_ROUTE = /^\/api\/projects\/[^/]+\/photos\/[^/?#]+(?:[?#]|$)/
const DRIVE_DOWNLOAD_ROUTE = "/api/google/download/"

/** Compass routes that understand `?size=`; any other URL is left alone. */
function acceptsRendition(src: string): boolean {
  return src.startsWith(DRIVE_DOWNLOAD_ROUTE) || PROJECT_PHOTO_ROUTE.test(src)
}

/** Adds `size=<rendition>` to a Compass photo URL, keeping its other params. */
export function withPhotoRendition(src: string, rendition: PhotoRendition): string {
  if (!acceptsRendition(src)) return src
  const url = new URL(src, "https://compass.invalid")
  url.searchParams.set("size", rendition)
  return `${url.pathname}${url.search}${url.hash}`
}

/** The thumbnail-size URL for a photo shown in a grid, strip or list. */
export function photoThumbnailSrc(src: string): string {
  return withPhotoRendition(src, "thumb")
}
