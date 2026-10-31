import { describe, expect, it } from "vitest"

import { parseJsonRecord, parseRfqScopeItems, parseRfqTemplateReview, toPurchaseOrderItem, toRfqItem, toTodoItem } from "../records"
import type { OperationRow } from "../store"

function row(overrides: Partial<OperationRow> = {}): OperationRow {
  return {
    id: "op-1",
    projectId: "project-a",
    sourceSystem: "compass",
    sourceRecordType: "rfq",
    sourceRecordId: null,
    sourceRecordNumber: "N-1-RFQ-001",
    title: "Framing",
    description: "Frame the house",
    status: "draft",
    priority: "normal",
    assigneeType: "vendor",
    assigneeName: null,
    siteContactPhone: null,
    companyName: "Acme Framing",
    costCode: null,
    startDate: null,
    dueDate: null,
    amount: null,
    externalUrl: null,
    sageJobId: null,
    sageJobNumber: null,
    sageVendorId: null,
    sageVendorName: null,
    sagePhaseCode: null,
    sageCostCode: null,
    sageTaxGroup: null,
    sageShipTo: null,
    sageOrderDate: null,
    sageRequiredDate: null,
    sageWriteStatus: "not_ready",
    sagePayloadJson: null,
    syncDirection: "write",
    syncStatus: "compass_only",
    lastSyncedAt: null,
    awardedRfqId: null,
    vendorId: null,
    createdAt: "2026-10-31T00:00:00.000Z",
    updatedAt: "2026-10-31T00:00:00.000Z",
    ...overrides,
  }
}

describe("operation records", () => {
  it("reads RFQ scope lines, falling back to the description", () => {
    expect(parseRfqScopeItems(null, "Frame it")).toEqual([
      { lineNumber: 1, description: "Frame it", phaseCode: null, costCode: null, notes: null },
    ])
    expect(parseRfqScopeItems(parseJsonRecord('{"scopeItems":[{"description":"Walls","costCode":"06"},"bad"]}'), null)).toEqual([
      { lineNumber: 1, description: "Walls", phaseCode: null, costCode: "06", notes: null },
    ])
    expect(parseJsonRecord("not json")).toBeNull()
  })

  it("reports template review only while something is unresolved", () => {
    expect(parseRfqTemplateReview({ templateReview: { unresolvedPlaceholders: [], requiresDocumentPackage: false } })).toBeNull()
    expect(parseRfqTemplateReview({ templateReview: { unresolvedPlaceholders: ["{{x}}", 3] } })).toEqual({
      unresolvedPlaceholders: ["{{x}}"],
      requiresDocumentPackage: false,
    })
  })

  it("returns the server's allowed actions with each RFQ", () => {
    const draft = toRfqItem(row(), "vendor@example.com")
    expect(draft.recipientEmail).toBe("vendor@example.com")
    expect(draft.actions).toMatchObject({ canEdit: true, canDelete: true, canEmail: true, sharingMarksSent: true })
    const sent = toRfqItem(row({ status: "sent", sagePayloadJson: '{"recipientEmail":"a@b.co"}' }), null)
    expect(sent.recipientEmail).toBe("a@b.co")
    expect(sent.actions).toMatchObject({ canDelete: false, canEmail: true, sharingMarksSent: false })
  })

  it("returns the server's allowed actions with to-dos and purchase orders", () => {
    expect(toTodoItem(row({ sourceRecordType: "staff_task", status: "archived" }), new Set()).actions).toEqual({
      canEdit: false,
      canRestore: true,
    })
    const order = toPurchaseOrderItem(
      row({ sourceRecordType: "purchase_order", sageWriteStatus: "draft_ready", syncStatus: "pending_sage" }),
      [],
      { address: null, email: "po@vendor.co" },
    )
    expect(order.actions.canEdit).toBe(true)
    expect(order.vendorEmail).toBe("po@vendor.co")
  })
})
