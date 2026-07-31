import { describe, expect, it } from "vitest"

import {
  allowedChangeOrderTransitions,
  canEditChangeOrderContent,
  canTransitionChangeOrder,
  isExternallyPublishedChangeOrderStatus,
} from "@/lib/change-orders/status"

describe("change order workflow", () => {
  it("moves operational work through review before approval", () => {
    expect(allowedChangeOrderTransitions("submitted")).toContain("triage")
    expect(allowedChangeOrderTransitions("pricing")).toContain("internal_review")
    expect(allowedChangeOrderTransitions("internal_review")).toContain(
      "approved_for_owner"
    )
    expect(allowedChangeOrderTransitions("closed")).toEqual([])
  })

  it("requires approval authority for owner approval, signature, and Sage states", () => {
    expect(
      canTransitionChangeOrder({
        from: "internal_review",
        to: "approved_for_owner",
        internal: true,
        canApprove: false,
      })
    ).toBe(false)
    expect(
      canTransitionChangeOrder({
        from: "internal_review",
        to: "approved_for_owner",
        internal: true,
        canApprove: true,
      })
    ).toBe(true)
    expect(
      canTransitionChangeOrder({
        from: "signature_pending",
        to: "executed",
        internal: true,
        canApprove: false,
      })
    ).toBe(false)
  })

  it("lets an external requester answer a needs-information return only", () => {
    expect(
      canTransitionChangeOrder({
        from: "needs_information",
        to: "submitted",
        internal: false,
        canApprove: false,
      })
    ).toBe(true)
    expect(
      canTransitionChangeOrder({
        from: "submitted",
        to: "triage",
        internal: false,
        canApprove: false,
      })
    ).toBe(false)
    expect(
      canEditChangeOrderContent({
        status: "needs_information",
        internal: false,
        isRequester: true,
      })
    ).toBe(true)
  })

  it("publishes only approval-and-later states to non-requesting owners", () => {
    expect(isExternallyPublishedChangeOrderStatus("internal_review")).toBe(false)
    expect(
      isExternallyPublishedChangeOrderStatus("approved_for_owner")
    ).toBe(true)
    expect(isExternallyPublishedChangeOrderStatus("closed")).toBe(true)
  })
})
