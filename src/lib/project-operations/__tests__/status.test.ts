import { describe, expect, it } from "vitest"

import { purchaseOrderStatusAfterEmail, statusLabel } from "@/lib/project-operations/status"

describe("project operation statuses", () => {
  it("normalizes imported labels for display", () => {
    expect(statusLabel("Partially Received")).toBe("Partially Received")
    expect(statusLabel("response_received")).toBe("Response Received")
  })

  it("marks newly issued POs sent without downgrading later lifecycle states", () => {
    expect(purchaseOrderStatusAfterEmail("draft")).toBe("sent")
    expect(purchaseOrderStatusAfterEmail("approved")).toBe("sent")
    expect(purchaseOrderStatusAfterEmail("ordered")).toBe("ordered")
    expect(purchaseOrderStatusAfterEmail("received")).toBe("received")
  })
})
