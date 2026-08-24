import { describe, expect, it } from "vitest"

import { buildNuTechAirliteWorkbookPlan } from "@/lib/nutech/airlite-workbook"

describe("Nu-Tech Airlite workbook plan", () => {
  it("fills legacy mapped rows and carries new products through the explicit addendum", () => {
    const plan = buildNuTechAirliteWorkbookPlan({
      purchaseOrderNumber: "N-2601-PO-1",
      purchaseOrderDate: "2026-08-24",
      requestedDeliveryDate: "2026-09-01",
      projectName: "Test Fox Blocks order",
      jobsiteAddress: "100 Test Way",
      orderContactName: "Rebekah Example",
      orderContactPhone: "719-686-0770",
      orderContactEmail: "orders@nutechcolorado.com",
      deliveryContact: "Client · 719-555-0100",
      lines: [
        {
          manufacturerSku: "FOX-S600A",
          name: "Straight",
          origin: "CSC",
          category: "block",
          quantity: 24,
          minimumOrderIncrement: 12,
          packageLabel: "12",
          priceUnit: "each",
          airliteTemplateRow: 28,
          unitCostCents: 2190,
        },
        {
          manufacturerSku: "L921T809B",
          name: "Fox Web 4 inch",
          origin: "Omaha",
          category: "web",
          quantity: 2,
          minimumOrderIncrement: 1,
          packageLabel: "230/box",
          priceUnit: "box",
          airliteTemplateRow: null,
          unitCostCents: 16100,
        },
      ],
    })

    expect(plan.addendumItemCount).toBe(1)
    expect(plan.totalCostCents).toBe(84760)
    expect(plan.updates).toContainEqual({
      range: "USLvl3!H28",
      values: [[2]],
    })
    expect(plan.updates).toContainEqual({
      range: "USLvl3!J87",
      values: [[847.6]],
    })
    expect(plan.addendumValues[4]).toEqual([
      "L921T809B",
      "Fox Web 4 inch",
      "Omaha",
      2,
      "box",
      "230/box",
      161,
      322,
    ])
  })

  it("rejects quantities that do not satisfy manufacturer package increments", () => {
    expect(() =>
      buildNuTechAirliteWorkbookPlan({
        purchaseOrderNumber: "PO-1",
        purchaseOrderDate: "2026-08-24",
        requestedDeliveryDate: null,
        projectName: "Test",
        jobsiteAddress: null,
        orderContactName: "Staff",
        orderContactPhone: null,
        orderContactEmail: "staff@example.com",
        deliveryContact: null,
        lines: [
          {
            manufacturerSku: "FOX-S600A",
            name: "Straight",
            origin: "CSC",
            category: "block",
            quantity: 13,
            minimumOrderIncrement: 12,
            packageLabel: "12",
            priceUnit: "each",
            airliteTemplateRow: 28,
            unitCostCents: 2190,
          },
        ],
      })
    ).toThrow("positive multiple of 12")
  })
})
