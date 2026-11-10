/** Shared text helpers (architecture standard, section 4). */

/** A file name safe for Drive and downloads: no path separators, never blank. */
export function safeFileName(value: string, fallback = "attachment"): string {
  const normalized = value.replace(/[/:\\]/g, "-").trim()
  return normalized.length > 0 ? normalized : fallback
}
