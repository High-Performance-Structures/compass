import { CHANGE_ORDER_STATUSES, type ChangeOrderStatus } from "@/lib/domain/estimates/statuses"
import { staffTargetsFrom } from "@/lib/domain/estimates/change-order-machine"
import { isListValue } from "@/lib/shared/statuses"

export type { ChangeOrderStatus }

// Which statuses staff may pick from each one comes from the change order
// machine (src/lib/domain/estimates/change-order-machine.ts).
const APPROVAL_STATUSES = new Set<ChangeOrderStatus>([
  "approved_for_owner",
  "signature_pending",
  "executed",
  "sage_pending",
  "synced",
  "closed",
])

export function isChangeOrderStatus(
  value: string
): value is ChangeOrderStatus {
  return isListValue(CHANGE_ORDER_STATUSES, value)
}

export function changeOrderStatusLabel(status: ChangeOrderStatus): string {
  return status
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

export function changeOrderDisplayStatus(
  status: ChangeOrderStatus,
  sourceType: string
): string {
  if (sourceType !== "buildertrend_import") {
    return changeOrderStatusLabel(status)
  }
  // Imported "executed" means approved in the source system, not signed in
  // Compass. The source itself is shown with the shared [BT] tag, not here.
  if (status === "executed") return "Approved"
  return changeOrderStatusLabel(status)
}

export function allowedChangeOrderTransitions(
  status: ChangeOrderStatus
): readonly ChangeOrderStatus[] {
  return staffTargetsFrom(status)
}

export function canTransitionChangeOrder(input: {
  readonly from: ChangeOrderStatus
  readonly to: ChangeOrderStatus
  readonly internal: boolean
  readonly canApprove: boolean
}): boolean {
  if (!staffTargetsFrom(input.from).includes(input.to)) return false
  if (!input.internal) {
    return input.from === "needs_information" && input.to === "submitted"
  }
  if (APPROVAL_STATUSES.has(input.to)) return input.canApprove
  return true
}

export function isExternallyPublishedChangeOrderStatus(
  status: ChangeOrderStatus
): boolean {
  return APPROVAL_STATUSES.has(status)
}

export function isExecutedChangeOrderStatus(
  status: ChangeOrderStatus
): boolean {
  return ["executed", "sage_pending", "synced", "closed"].includes(status)
}

export function canEditChangeOrderContent(input: {
  readonly status: ChangeOrderStatus
  readonly internal: boolean
  readonly isRequester: boolean
}): boolean {
  if (input.internal) {
    return !["executed", "sage_pending", "synced", "closed", "void"].includes(
      input.status
    )
  }
  return (
    input.isRequester &&
    ["submitted", "needs_information"].includes(input.status)
  )
}
