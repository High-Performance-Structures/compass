export type ContactNotesDisplay = {
  /** Human-written note text, or null when the field only held import metadata. */
  readonly text: string | null
  /** A verified Buildertrend link carried over from the import, if any. */
  readonly buildertrendHref: string | null
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeBuildertrendHref(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const trusted = ["buildertrend.net", "buildertrend.com"].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
    return url.protocol === "https:" && trusted ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * Imported contacts can carry a JSON blob such as {"buildertrendHref": "…"}
 * in their notes. Show people the link, never the raw JSON.
 */
export function contactNotesDisplay(notes: string | null): ContactNotesDisplay {
  const trimmed = notes?.trim() ?? ""
  if (!trimmed) return { text: null, buildertrendHref: null }
  if (!trimmed.startsWith("{")) return { text: trimmed, buildertrendHref: null }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!isRecord(parsed)) return { text: trimmed, buildertrendHref: null }
    const noteText = ["notes", "note", "text"]
      .map((key) => parsed[key])
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    return {
      text: noteText?.trim() ?? null,
      buildertrendHref: safeBuildertrendHref(parsed.buildertrendHref),
    }
  } catch {
    return { text: trimmed, buildertrendHref: null }
  }
}
