export const WARRANTY_CLAIM_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const

export type WarrantyClaimPriority =
  (typeof WARRANTY_CLAIM_PRIORITIES)[number]

export const WARRANTY_CLAIM_STATUSES = [
  "submitted",
  "acknowledged",
  "visit_scheduled",
  "in_progress",
  "waiting_on_owner",
  "resolved",
  "closed",
  "rejected",
] as const

export type WarrantyClaimStatus = (typeof WARRANTY_CLAIM_STATUSES)[number]

export const WARRANTY_PROMOTION_STATES = [
  "actionable",
  "review_required",
  "archive_only",
  "rejected",
] as const

export type WarrantyPromotionState =
  (typeof WARRANTY_PROMOTION_STATES)[number]

export function warrantyClaimPriority(
  value: string
): WarrantyClaimPriority | null {
  return WARRANTY_CLAIM_PRIORITIES.find((priority) => priority === value) ?? null
}

export function warrantyClaimStatus(value: string): WarrantyClaimStatus | null {
  return WARRANTY_CLAIM_STATUSES.find((status) => status === value) ?? null
}

export function warrantyPromotionState(
  value: string
): WarrantyPromotionState | null {
  return WARRANTY_PROMOTION_STATES.find((state) => state === value) ?? null
}

function normalizedStage(value: string | null): string {
  return value?.trim().toLowerCase().replace(/[\s_-]+/g, " ") ?? ""
}

export function isWarrantyProjectStage(input: {
  readonly status: string | null
  readonly jobStatusId: string | null
}): boolean {
  return [input.status, input.jobStatusId].some((value) => {
    const normalized = normalizedStage(value)
    return normalized.includes("warranty") || normalized.includes("service")
  })
}

export function isOwnerVisibleWarrantyClaim(input: {
  readonly audience: string
  readonly promotionState: string
}): boolean {
  return input.audience === "owner" && input.promotionState === "actionable"
}

export function canOwnerDeleteWarrantyClaim(input: {
  readonly status: string
  readonly claimantUserId: string | null
  readonly viewerUserId: string
}): boolean {
  return (
    input.claimantUserId === input.viewerUserId && input.status === "submitted"
  )
}
