/** Shared type guards and value readers (architecture standard, section 4). */

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A trimmed, non-empty string, or null. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** A finite number from a number or numeric string, or null. */
export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** A field of an unknown object, read without casting. */
export function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}
