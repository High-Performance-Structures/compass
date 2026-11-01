/**
 * Imported-record sources (owner-approved standard, see
 * docs/development/ui-standards.md). Records that came from another system
 * look like native Compass records and carry only a short, muted code such
 * as "[BT]". The full source name is for tooltips and screen readers only.
 *
 * Add a new source by adding one entry here; callers pass the source key.
 */
const RECORD_SOURCES = {
  buildertrend: { code: "BT", name: "Buildertrend" },
} as const satisfies Record<string, { readonly code: string; readonly name: string }>

export type RecordSource = keyof typeof RECORD_SOURCES

/** Short inline tag, e.g. "[BT]". Use this in print and other plain text. */
export function recordSourceTag(source: RecordSource): string {
  return `[${RECORD_SOURCES[source].code}]`
}

/** Tooltip / screen-reader text, e.g. "Imported from Buildertrend". */
export function recordSourceDescription(source: RecordSource): string {
  return `Imported from ${RECORD_SOURCES[source].name}`
}
