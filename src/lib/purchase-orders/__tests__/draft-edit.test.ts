import { describe, expect, it } from "vitest"

import {
  canEditPurchaseOrderDraft,
  canRemovePurchaseOrderLine,
} from "../draft-edit"

const EDITABLE_DRAFT = {
  sourceSystem: "compass",
  status: "draft",
  syncStatus: "pending_sage",
  sageWriteStatus: "draft_ready",
} as const

describe("canEditPurchaseOrderDraft", () => {
  it("allows an unsent Compass draft", () => {
    expect(canEditPurchaseOrderDraft(EDITABLE_DRAFT)).toBe(true)
  })

  it.each([
    { ...EDITABLE_DRAFT, sourceSystem: "sage" },
    { ...EDITABLE_DRAFT, status: "sent" },
    { ...EDITABLE_DRAFT, syncStatus: "queued_sage" },
    { ...EDITABLE_DRAFT, syncStatus: "syncing" },
    { ...EDITABLE_DRAFT, syncStatus: "synced" },
    { ...EDITABLE_DRAFT, sageWriteStatus: "queued" },
  ])("locks a PO after it leaves the editable draft state", (purchaseOrder) => {
    expect(canEditPurchaseOrderDraft(purchaseOrder)).toBe(false)
  })
})

describe("canRemovePurchaseOrderLine", () => {
  it("allows an editor to remove the final existing line", () => {
    expect(canRemovePurchaseOrderLine(1, true)).toBe(true)
    expect(canRemovePurchaseOrderLine(0, true)).toBe(true)
  })

  it("keeps a new purchase order from having no line rows", () => {
    expect(canRemovePurchaseOrderLine(1, false)).toBe(false)
    expect(canRemovePurchaseOrderLine(2, false)).toBe(true)
  })
})
