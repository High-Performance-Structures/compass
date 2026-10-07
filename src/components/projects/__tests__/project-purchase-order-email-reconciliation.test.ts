import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/actions/project-operations", () => ({
  reconcilePurchaseOrderEmailDelivery: vi.fn(),
  sendPurchaseOrderEmail: vi.fn(),
}))

import { ProjectPurchaseOrderEmailButton } from "@/components/projects/project-purchase-order-email-button"

describe("ProjectPurchaseOrderEmailButton reconciliation state", () => {
  it("replaces the send control with an explicit reconciliation workflow", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectPurchaseOrderEmailButton, {
        projectId: "project-1",
        purchaseOrderId: "po-1",
        expectedRevision: 4,
        emailDeliveryRequiresReconciliation: true,
        poNumber: "N-001-PO-001",
        projectLabel: "N-001 · Test Project",
        supplierName: "Vendor",
        supplierEmail: "vendor@example.com",
        recipientOptions: [],
      })
    )

    expect(html).toContain("Reconcile email")
    expect(html).not.toContain("Email supplier")
  })
})
