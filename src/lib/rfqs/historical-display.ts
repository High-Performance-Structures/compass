function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function display(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.trim() !== "--" ? value : null
}

/** Preserve an explicit captured submitter; a vendor label or date is not a person mapping. */
export function historicalSubmitterDisplay(captured: unknown): string | null {
  if (!record(captured) || !record(captured.vendor) || !record(captured.vendor.legacyParticipantEvidence)) return null
  return display(captured.vendor.legacyParticipantEvidence.submittedBy)
}

/** Only the recognized vendor-note field enters the staff DTO, never the raw capture. */
export function historicalVendorNotes(captured: unknown): string | null {
  if (!record(captured)) return null
  if (record(captured.notes)) return display(captured.notes.notesFromVendorDisplay)
  const legacy = captured.legacyEvidence
  if (!record(legacy) || legacy.adapter !== "o152-older-source-adapter-v1" ||
      typeof legacy.sourcePayloadJson !== "string") return null
  try {
    const original: unknown = JSON.parse(legacy.sourcePayloadJson)
    return record(original) && record(original.responseEvidence)
      ? display(original.responseEvidence.notes) : null
  } catch { return null }
}
