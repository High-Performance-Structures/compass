import { describe, expect, it } from "vitest"

import {
  canOwnerDeleteWarrantyClaim,
  isOwnerVisibleWarrantyClaim,
  isWarrantyProjectStage,
  warrantyClaimPriority,
  warrantyClaimStatus,
} from "@/lib/warranty/status"

describe("warranty claim guardrails", () => {
  it("recognizes warranty and service stages", () => {
    expect(isWarrantyProjectStage({ status: "WARRANTY", jobStatusId: "current" })).toBe(true)
    expect(isWarrantyProjectStage({ status: "OPEN", jobStatusId: "warranty_service" })).toBe(true)
    expect(isWarrantyProjectStage({ status: "OPEN", jobStatusId: "current" })).toBe(false)
  })

  it("requires owner audience and an actionable promotion", () => {
    expect(isOwnerVisibleWarrantyClaim({ audience: "owner", promotionState: "actionable" })).toBe(true)
    expect(isOwnerVisibleWarrantyClaim({ audience: "internal", promotionState: "actionable" })).toBe(false)
    expect(isOwnerVisibleWarrantyClaim({ audience: "owner", promotionState: "review_required" })).toBe(false)
  })

  it("only lets a claimant retract an unacknowledged submission", () => {
    expect(canOwnerDeleteWarrantyClaim({ status: "submitted", claimantUserId: "user-1", viewerUserId: "user-1" })).toBe(true)
    expect(canOwnerDeleteWarrantyClaim({ status: "acknowledged", claimantUserId: "user-1", viewerUserId: "user-1" })).toBe(false)
    expect(canOwnerDeleteWarrantyClaim({ status: "submitted", claimantUserId: "user-2", viewerUserId: "user-1" })).toBe(false)
  })

  it("rejects unknown statuses and priorities", () => {
    expect(warrantyClaimStatus("resolved")).toBe("resolved")
    expect(warrantyClaimStatus("done")).toBeNull()
    expect(warrantyClaimPriority("urgent")).toBe("urgent")
    expect(warrantyClaimPriority("critical")).toBeNull()
  })
})
