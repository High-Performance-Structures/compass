import { cleanText } from "@/lib/shared/guards"

/*
 * Pure validation shared by the documents actions (project documents and
 * contract packets). No database or network access.
 */

/** Trimmed text, or an error naming the field when it is blank. */
export function requiredText(value: string | null, label: string): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

/** A blank date is null; anything else must be YYYY-MM-DD. */
export function cleanDocumentDate(value: string | null): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error("Document date must use YYYY-MM-DD.")
  }
  return cleaned
}
