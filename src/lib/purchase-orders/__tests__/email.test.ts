import { describe, expect, it } from "vitest"

import {
  purchaseOrderEmailHtml,
  purchaseOrderEmailText,
  type PurchaseOrderEmailInput,
} from "@/lib/purchase-orders/email"
import { projectBrandFor } from "@/lib/project-branding"

function emailInput(deliveryLocation: string | null): PurchaseOrderEmailInput {
  return {
    brand: projectBrandFor({ projectNumber: "O-202-595" }),
    projectName: "Test Project",
    projectNumber: "O-202-595",
    senderName: "Project Manager",
    message: "Please confirm receipt.",
    deliveryLocation,
    order: {
      sourceRecordNumber: "O-202-595-PO-001",
      companyName: "Test Supplier",
      sageOrderDate: "2026-08-20",
      dueDate: "2026-08-25",
      amount: 125,
      lines: [
        {
          lineNumber: 1,
          description: "Delivery item",
          phaseCode: "01",
          costCode: "1000",
          quantity: 1,
          unit: "EA",
          unitCost: 125,
          amount: 125,
        },
      ],
    },
  }
}

describe("purchase order email delivery location", () => {
  it("includes a multiline jobsite address in the plain-text email", () => {
    const text = purchaseOrderEmailText(
      emailInput("123 Main St\nDenver, CO 80202")
    )

    expect(text).toContain(
      "Delivery Location: 123 Main St\nDenver, CO 80202"
    )
  })

  it("includes and safely escapes the jobsite address in the HTML email", () => {
    const html = purchaseOrderEmailHtml(
      emailInput("123 Main St & Hwy 24\nDenver, CO")
    )

    expect(html).toContain("Delivery Location")
    expect(html).toContain("123 Main St &amp; Hwy 24<br>Denver, CO")
    expect(html).not.toContain("123 Main St & Hwy 24")
  })

  it("shows a clear fallback when delivery has not been chosen", () => {
    expect(purchaseOrderEmailText(emailInput(null))).toContain(
      "Delivery Location: TBD"
    )
    expect(purchaseOrderEmailHtml(emailInput(null))).toContain(">TBD</td>")
  })

  it("includes the department contact defaults in both email formats", () => {
    const input = emailInput("Pick-Up")

    expect(purchaseOrderEmailText(input)).toContain(
      "PO Box 9046\nWoodland Park, CO 80866\nTel: 719.630.8767\nEmail: accounting@openrangeconstruction.com"
    )
    expect(purchaseOrderEmailHtml(input)).toContain(
      "PO Box 9046<br>Woodland Park, CO 80866<br>Tel: 719.630.8767<br>Email: accounting@openrangeconstruction.com"
    )
  })
})
