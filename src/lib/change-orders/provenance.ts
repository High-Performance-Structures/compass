import type { ChangeOrderRequesterType } from "@/lib/change-orders/access"

// Unknown is a historical data state, never a role that grants workflow access.
export type RecordedChangeOrderRequesterType = ChangeOrderRequesterType | "unknown"

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
