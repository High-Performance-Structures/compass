const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/

/** Only accepted Drive URLs can be granted recipient-specific viewer access. */
export function driveFileIdFromRfqLink(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || value.length > 2_000) return null
  const host = url.hostname.toLowerCase()
  let fileId: string | null = null
  if (host === "drive.google.com") {
    const pathMatch = /^\/(?:file\/d|drive\/folders)\/([^/]+)/.exec(url.pathname)
    fileId = pathMatch?.[1] ?? (url.pathname === "/open" ? url.searchParams.get("id") : null)
  } else if (host === "docs.google.com") {
    const pathMatch = /^\/(?:document|spreadsheets|presentation)\/d\/([^/]+)/.exec(url.pathname)
    fileId = pathMatch?.[1] ?? null
  }
  return fileId && FILE_ID_PATTERN.test(fileId) ? fileId : null
}
