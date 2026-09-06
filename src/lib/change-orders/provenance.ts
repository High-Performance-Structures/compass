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
