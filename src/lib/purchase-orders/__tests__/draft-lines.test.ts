import { describe, expect, it } from "vitest"

import {
  draftLinesFromPurchaseOrder,
  type DraftPurchaseOrderLine,
} from "../draft-lines"

const FALLBACK_LINE: DraftPurchaseOrderLine = {
  id: "new-line",
  description: "",
  phaseCode: "",
  costCode: "",
  quantity: "1",
  unitCost: "",
  unit: "",
  amount: "",
  taxGroup: "",
}

const EXISTING_LINE = {
  id: "existing-line",
  description: "Concrete",
  phaseCode: "03",
  costCode: "03100",
  quantity: 2,
  unitCost: 12.5,
  unit: "EA",
  amount: 25,
  taxGroup: null,
} as const

describe("draftLinesFromPurchaseOrder", () => {
  it("keeps a new purchase order's fallback line", () => {
    expect(draftLinesFromPurchaseOrder(null, () => FALLBACK_LINE)).toEqual([
      FALLBACK_LINE,
    ])
  })

  it("keeps an existing zero-line draft empty after reload", () => {
    expect(
      draftLinesFromPurchaseOrder({ lines: [] }, () => FALLBACK_LINE),
    ).toEqual([])
  })

  it("maps persisted lines back into editable draft rows", () => {
    expect(
      draftLinesFromPurchaseOrder({ lines: [EXISTING_LINE] }, () => FALLBACK_LINE),
    ).toEqual([
      {
        id: "existing-line",
        description: "Concrete",
        phaseCode: "03",
        costCode: "03100",
        quantity: "2",
        unitCost: "12.5",
        unit: "EA",
        amount: "",
        taxGroup: "",
      },
    ])
  })
})
