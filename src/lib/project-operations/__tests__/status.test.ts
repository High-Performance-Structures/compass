import { describe, expect, it } from "vitest"

import {
  isClosedProjectOperationStatus,
  isPurchaseOrderStatus,
  isRfqStatus,
  parseProjectOperationStatusFilter,
  projectOperationMatchesStatusFilter,
  purchaseOrderStatusAfterEmail,
  statusLabel,
} from "@/lib/project-operations/status"

describe("project operation statuses", () => {
  it("normalizes imported labels for display and filtering", () => {
    expect(statusLabel("Partially Received")).toBe("Partially Received")
    expect(
      projectOperationMatchesStatusFilter(
        "Partially Received",
        "partially_received"
      )
    ).toBe(true)
  })

  it("keeps open and closed queues consistent", () => {
    expect(isClosedProjectOperationStatus("complete")).toBe(true)
    expect(isClosedProjectOperationStatus("Cancelled")).toBe(true)
    expect(isClosedProjectOperationStatus("ordered")).toBe(false)
    expect(projectOperationMatchesStatusFilter("ordered", "open")).toBe(true)
    expect(projectOperationMatchesStatusFilter("void", "closed")).toBe(true)
  })

  it("accepts only statuses supported by the matching workflow", () => {
    expect(isPurchaseOrderStatus("partially_received")).toBe(true)
    expect(isPurchaseOrderStatus("response_received")).toBe(false)
    expect(isRfqStatus("response_received")).toBe(true)
    expect(isRfqStatus("partially_received")).toBe(false)
  })

  it("marks newly issued POs sent without downgrading later lifecycle states", () => {
    expect(purchaseOrderStatusAfterEmail("draft")).toBe("sent")
    expect(purchaseOrderStatusAfterEmail("approved")).toBe("sent")
    expect(purchaseOrderStatusAfterEmail("ordered")).toBe("ordered")
    expect(purchaseOrderStatusAfterEmail("received")).toBe("received")
  })

  it("defaults filters to open and accepts query arrays", () => {
    expect(parseProjectOperationStatusFilter(undefined)).toBe("open")
    expect(parseProjectOperationStatusFilter(["Response Received"])).toBe(
      "response_received"
    )
  })
})
