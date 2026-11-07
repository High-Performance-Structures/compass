import type { ChangeOrderRequesterType } from "@/lib/change-orders/access"

// Unknown is a historical data state, never a role that grants workflow access.
export type RecordedChangeOrderRequesterType = ChangeOrderRequesterType | "unknown"

// Imported text may include source wording or later reconstruction. Preserve it
// without presenting those assertions as independently verified evidence.
export const HISTORICAL_CHANGE_ORDER_TEXT_CONTEXT =
  "Descriptions, notes and document titles are retained as recorded. Their wording does not independently verify initiation, owner acceptance or signature, staff approval, or purpose."

export function readChangeOrderRequesterType(
  sourceType: string,
  requesterType: string,
): RecordedChangeOrderRequesterType | null {
  if (
    requesterType === "internal" ||
    requesterType === "owner" ||
    requesterType === "subcontractor"
  ) return requesterType
  if (sourceType === "buildertrend_import" && requesterType === "unknown") {
    return "unknown"
  }
  return null
}

export type ChangeOrderRequesterDisplay = {
  readonly requesterType: RecordedChangeOrderRequesterType
  /** Set when the stored requester value isn't one Compass recognizes. */
  readonly issue: string | null
}

// Displaying a record never depends on its requester label: access is decided
// separately by audience and status. A stored value Compass doesn't recognize
// is shown as "unknown" (which grants nothing) with the problem called out,
// instead of hiding a real change order from the list and its detail page.
export function displayChangeOrderRequesterType(
  sourceType: string,
  requesterType: string,
): ChangeOrderRequesterDisplay {
  const recorded = readChangeOrderRequesterType(sourceType, requesterType)
  if (recorded !== null) return { requesterType: recorded, issue: null }
  return {
    requesterType: "unknown",
    issue: `Requester type "${requesterType}" isn't a recognized value (internal, owner or subcontractor); shown as unknown until the record is corrected.`,
  }
}
