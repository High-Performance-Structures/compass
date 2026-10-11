import { describe, expect, it } from "vitest"

import {
  airlitePurchaseOrderLabel,
  buildNuTechAirliteWorkbookPlan,
  nextAirlitePoSequence,
  formatAirliteDate,
  readNuTechAirliteFormLayout,
  type NuTechAirliteOrderHeader,
} from "@/lib/nutech/airlite-workbook"

// The Fox Blocks form Rev 1/1/2026, trimmed to the rows the planner reads.
function form2026(): unknown[][] {
  const rows: unknown[][] = Array.from({ length: 86 }, () => [])
  rows[20] = ["Enter Each Qty.", " Item # ", "", "Description "]
  rows[30] = [48, "FOX-S800", "", '8" Straight Block']
  rows[31] = [6, "FOX-EC890", "", '8"  90* Corner Block ']
  rows[46] = ["=SUM(A22:A46)", "", "", "", "", "", "", "", "Block Subtotal"]
  rows[55] = [1, "FOX-HVClips", "", "Horiz/Vertical Clips 250 ct Box"]
  rows[60] = ["", "Fox Spray Foam Gun", "", "Fox-Spraygun"]
  rows[64] = ["", "", "", "", "", "", "", "", "Accessories Subtotal"]
  rows[67] = ["", "", "", "", "", "", "", "", "Freight", 0]
  rows[72] = ["Misc Order info: (i.e cut/fill items, special instructions/directions):"]
  return rows
}

const delivery: NuTechAirliteOrderHeader = {
  purchaseOrderLabel: "N-0-0-PO-001 Reeves",
  purchaseOrderDate: "9/30/2026",
  fulfillment: "delivery",
  requestedDate: null,
  freight: "1000 (CSC Rate)",
  fob: "Omaha",
  shippingWarehouse: "Sonoco",
  shipToLines: ["11730 Red Lodge Rd.", "Peyton, CO 80831"],
  deliveryContact: "Jody Reeves",
  miscNote: null,
}

const line = { name: "Item", origin: "CSC", packageLabel: "12", priceUnit: "each" }

describe("Nu-Tech Airlite order form", () => {
  it("finds item rows and the misc row on the 2026 form", () => {
    const layout = readNuTechAirliteFormLayout(form2026())
    expect(layout.itemRows.get("FOXS800")).toBe(31)
    expect(layout.itemRows.get("FOXHVCLIPS")).toBe(56)
    expect(layout.miscRow).toBe(73)
    // Named in B, numbered in the description.
    expect(layout.itemRows.get("FOXSPRAYGUN")).toBe(61)
  })

  it("fills a delivery the way staff do and clears rows left from an earlier PO", () => {
    const plan = buildNuTechAirliteWorkbookPlan({
      layout: readNuTechAirliteFormLayout(form2026()),
      header: delivery,
      lines: [{ ...line, manufacturerSku: "FOX-S800", quantity: 96, minimumOrderIncrement: 12, unitCostCents: 2230 }],
    })
    const at = (range: string): unknown => plan.updates.find((update) => update.range === `USLvl3!${range}`)?.values[0]?.[0]
    expect(at("B7")).toBe("N-0-0-PO-001 Reeves")
    expect(at("E6")).toBe("1000 (CSC Rate)")
    expect(at("E8")).toBe("Delivery")
    expect(at("I8")).toBe("ASAP")
    expect(at("I7")).toBe("")
    expect(at("G13")).toBe("11730 Red Lodge Rd.")
    expect(at("G14")).toBe("Peyton, CO 80831")
    expect(at("I19")).toBe("Jody Reeves")
    expect(at("A31")).toBe(96)
    expect(at("I31")).toBe(22.3)
    expect(at("A32")).toBe("")
    expect(at("A56")).toBe("")
    expect(at("I75")).toBe("9/30/2026")
    // The form's formulas own the bundle, line and total cells.
    expect(at("H31")).toBeUndefined()
    expect(at("J31")).toBeUndefined()
  })

  it("marks pickups CPU with a ship date and lists off-form items on the addendum", () => {
    const plan = buildNuTechAirliteWorkbookPlan({
      layout: readNuTechAirliteFormLayout(form2026()),
      header: { ...delivery, fulfillment: "pickup", requestedDate: "3/13/2026", deliveryContact: "Devin Dorrough", freight: "300" },
      lines: [
        { ...line, manufacturerSku: "fox-hvclips", quantity: 1, minimumOrderIncrement: 1, unitCostCents: 12725 },
        { ...line, manufacturerSku: "L921T809B", quantity: 2, minimumOrderIncrement: 1, unitCostCents: 16100 },
      ],
    })
    const at = (range: string): unknown => plan.updates.find((update) => update.range === `USLvl3!${range}`)?.values[0]?.[0]
    expect(at("E8")).toBe("CPU")
    expect(at("E6")).toBe("")
    expect(at("I7")).toBe("3/13/2026")
    expect(at("I19")).toBe("CPU Devin Dorrough")
    expect(at("A56")).toBe(1)
    expect(plan.addendumItemCount).toBe(1)
    expect(String(at("G73"))).toContain("Compass Addendum")
    expect(plan.addendumValues[4]).toEqual(["L921T809B", "Item", "CSC", 2, "each", "12", 161, 322])
  })

  it("rejects quantities that do not satisfy package increments", () => {
    expect(() =>
      buildNuTechAirliteWorkbookPlan({
        layout: readNuTechAirliteFormLayout(form2026()),
        header: delivery,
        lines: [{ ...line, manufacturerSku: "FOX-S800", quantity: 13, minimumOrderIncrement: 12, unitCostCents: 2230 }],
      })
    ).toThrow("positive multiple of 12")
  })

  it("formats dates the way the form shows them", () => {
    expect(formatAirliteDate("2026-03-06T19:04:21Z")).toBe("3/6/2026")
  })
})

describe("Airlite PO numbering", () => {
  it("continues from the Settings number, then from the last assigned", () => {
    expect(nextAirlitePoSequence({ assigned: null, lastAssigned: null, nextSetting: "1860" })).toBe(1860)
    expect(nextAirlitePoSequence({ assigned: null, lastAssigned: 1860, nextSetting: "1860" })).toBe(1861)
    expect(nextAirlitePoSequence({ assigned: null, lastAssigned: 1861, nextSetting: "1900" })).toBe(1900)
    expect(nextAirlitePoSequence({ assigned: 1855, lastAssigned: 1861, nextSetting: "1900" })).toBe(1855)
    expect(nextAirlitePoSequence({ assigned: null, lastAssigned: null, nextSetting: "" })).toBeNull()
  })

  it("labels the PO with the project number, sequence and last name", () => {
    expect(
      airlitePurchaseOrderLabel({ projectNumber: "N-0-0", sequence: 1860, fallbackNumber: "N-0-0-PO-001", clientLastName: "Reeves" })
    ).toBe("N-0-0-1860 Reeves")
    expect(
      airlitePurchaseOrderLabel({ projectNumber: "N-0-0", sequence: null, fallbackNumber: "N-0-0-PO-001", clientLastName: "Reeves" })
    ).toBe("N-0-0-PO-001 Reeves")
  })
})
