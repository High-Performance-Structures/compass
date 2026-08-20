import { describe, expect, it } from "vitest"

import {
  isStaleServerActionError,
  purchaseOrderSubmissionErrorMessage,
} from "@/lib/purchase-orders/action-errors"

describe("purchase order action errors", () => {
  it("recognizes a stale action identifier from an older deployment", () => {
    const error = new Error(
      'Server Action "609fce54d4b06dad-ed5a7d32c672ec167e5b46502b" was not found on the server.'
    )

    expect(isStaleServerActionError(error)).toBe(true)
    expect(purchaseOrderSubmissionErrorMessage(error, "create")).toContain(
      "Compass was updated"
    )
  })

  it("keeps actionable server errors and supplies a fallback for unknown failures", () => {
    expect(
      purchaseOrderSubmissionErrorMessage(
        new Error("A title is required."),
        "create"
      )
    ).toBe("A title is required.")
    expect(purchaseOrderSubmissionErrorMessage({}, "update")).toBe(
      "Could not update the purchase order draft."
    )
  })
})
