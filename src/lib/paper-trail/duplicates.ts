/**
 * Spotting a copy someone already saved by hand. Before Compass writes a
 * record's first Drive copy, it looks in the destination folder for a file
 * whose name carries the record's number. Numbers match whole: "CO-20" finds
 * "CO 20 signed.pdf" but not "CO-200.pdf", and separators may differ.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** A case-insensitive pattern for one key, or null when the key has no letters or digits. */
export function duplicateKeyPattern(key: string): RegExp | null {
  const tokens = key.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.length === 0) return null
  return new RegExp(`(?<![a-z0-9])${tokens.map(escapeRegExp).join("[^a-z0-9]{0,3}")}(?![0-9])`, "i")
}

export function nameMatchesKeys(fileName: string, keys: readonly string[]): boolean {
  return keys.some((key) => duplicateKeyPattern(key)?.test(fileName) ?? false)
}

export type ExistingDriveFile = { readonly id: string; readonly name: string }

/** The first file in the folder that looks like this record, ignoring files Compass wrote itself. */
export function findExistingCopy(
  files: readonly ExistingDriveFile[],
  keys: readonly string[],
  compassFileIds: ReadonlySet<string>,
): ExistingDriveFile | null {
  if (keys.length === 0) return null
  return files.find((file) => !compassFileIds.has(file.id) && nameMatchesKeys(file.name, keys)) ?? null
}

/**
 * Keys for a record number. A bare number ("3", "#3") is too common to match
 * alone, so it only counts with the record's label ("CO 3", "Change Order 3").
 */
export function recordNumberKeys(number: string | null | undefined, labels: readonly string[]): readonly string[] {
  const clean = number?.trim() ?? ""
  if (!clean) return []
  const digitsOnly = clean.replace(/^#/, "")
  if (/^\d+$/.test(digitsOnly)) return labels.map((label) => `${label} ${digitsOnly}`)
  // Short codes like "A1" are ambiguous the same way.
  if (clean.replace(/[^a-z0-9]/gi, "").length < 4) return labels.map((label) => `${label} ${clean}`)
  return [clean]
}
