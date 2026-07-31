export const CHANGE_ORDER_STATUSES = [
  "draft",
  "submitted",
  "triage",
  "needs_information",
  "pricing",
  "internal_review",
  "approved_for_owner",
  "signature_pending",
  "executed",
  "sage_pending",
  "synced",
  "closed",
  "declined",
  "void",
] as const

export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number]

const TRANSITIONS: Readonly<
  Record<ChangeOrderStatus, readonly ChangeOrderStatus[]>
> = {
  draft: ["submitted", "void"],
  submitted: ["triage", "needs_information", "declined", "void"],
  triage: ["needs_information", "pricing", "internal_review", "declined", "void"],
  needs_information: ["submitted", "triage", "pricing", "declined", "void"],
  pricing: ["needs_information", "internal_review", "declined", "void"],
  internal_review: [
    "needs_information",
    "pricing",
    "approved_for_owner",
    "declined",
    "void",
  ],
  approved_for_owner: [
    "internal_review",
    "signature_pending",
    "declined",
    "void",
  ],
  signature_pending: ["approved_for_owner", "executed", "declined", "void"],
  executed: ["sage_pending", "closed"],
  sage_pending: ["executed", "synced"],
  synced: ["closed"],
  closed: [],
  declined: [],
  void: [],
}

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
  return CHANGE_ORDER_STATUSES.some((status) => status === value)
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
  if (status === "executed") return "Approved · Buildertrend"
  return `${changeOrderStatusLabel(status)} · Buildertrend`
}

export function allowedChangeOrderTransitions(
  status: ChangeOrderStatus
): readonly ChangeOrderStatus[] {
  return TRANSITIONS[status]
}

export function canTransitionChangeOrder(input: {
  readonly from: ChangeOrderStatus
  readonly to: ChangeOrderStatus
  readonly internal: boolean
  readonly canApprove: boolean
}): boolean {
  if (!TRANSITIONS[input.from].includes(input.to)) return false
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
