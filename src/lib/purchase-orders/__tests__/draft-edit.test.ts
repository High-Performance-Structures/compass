import { describe, expect, it } from "vitest"

import { canEditPurchaseOrderDraft } from "../draft-edit"

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
