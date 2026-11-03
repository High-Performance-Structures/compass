import { describe, expect, it } from "vitest"

import {
  assigneeTypeForTask,
  cleanDate,
  normalizePurchaseOrderLines,
  normalizeRfqDocumentLinks,
  normalizeRfqScopeLines,
  normalizeTaskRecordType,
  operationCanQueueForSage,
  operationSyncKind,
  parseEmailList,
  projectDocumentNumberFor,
  projectTaskNumberFor,
  purchaseOrderActions,
  purchaseOrderHeaderCodes,
  purchaseOrderLineAmount,
  purchaseOrderRequestNumberFor,
  purchaseOrderTotal,
  requireText,
  rfqActions,
  sageShortProjectDocumentNumberFor,
  syncQueueStatus,
  todoActions,
  todoEventRow,
} from "../rules"
import type { CreatePurchaseOrderLineInput } from "../types"

function line(overrides: Partial<CreatePurchaseOrderLineInput> = {}): CreatePurchaseOrderLineInput {
  return {
    description: "Lumber",
    costCode: null,
    phaseCode: null,
    quantity: null,
    unitCost: null,
    unit: null,
    amountOverride: null,
    taxGroup: null,
    ...overrides,
  }
}

describe("purchase-order amounts are computed on the server", () => {
  it("prices a line as quantity × unit cost, rounded to the cent", () => {
    expect(purchaseOrderLineAmount({ quantity: 3, unitCost: 19.99, amountOverride: null })).toBe(59.97)
    // 2.5 × 19.99 is 49.97499… in floating point, which already displayed as $49.97.
    expect(purchaseOrderLineAmount({ quantity: 2.5, unitCost: 19.99, amountOverride: null })).toBe(49.97)
    expect(purchaseOrderLineAmount({ quantity: 1000, unitCost: 0.125, amountOverride: null })).toBe(125)
  })

  it("keeps a typed lump sum instead of the computed amount", () => {
    expect(purchaseOrderLineAmount({ quantity: 1, unitCost: 0, amountOverride: 5000 })).toBe(5000)
    expect(purchaseOrderLineAmount({ quantity: 4, unitCost: 10, amountOverride: 35.5 })).toBe(35.5)
  })

  it("ignores a non-finite override", () => {
    expect(purchaseOrderLineAmount({ quantity: 4, unitCost: 10, amountOverride: Number.NaN })).toBe(40)
  })

  // Parity with what was stored before: the client sent quantity × unitCost
  // (or the typed amount) and the server stored it as is.
  it("matches the previously stored amount to the cent for form input", () => {
    const cases: [number, number][] = [
      [1, 0],
      [1, 12.5],
      [3, 19.99],
      [7, 0.1],
      [12, 3.33],
      [0.5, 99.99],
      [144, 1.07],
      [2.75, 41.3],
    ]
    for (const [quantity, unitCost] of cases) {
      const legacy = quantity * unitCost
      const amount = purchaseOrderLineAmount({ quantity, unitCost, amountOverride: null })
      expect(Math.abs(amount - legacy)).toBeLessThanOrEqual(0.005 + 1e-9)
      expect(Math.round(amount * 100)).toBe(Math.round(legacy * 100))
    }
  })

  it("matches the Nu-Tech manufacturer PO amount exactly (integer cents × quantity)", () => {
    for (const [unitCostCents, quantity] of [
      [1999, 3],
      [12_345, 7],
      [5, 40],
      [250_000, 1],
    ]) {
      const legacy = (unitCostCents * quantity) / 100
      expect(purchaseOrderLineAmount({ quantity, unitCost: unitCostCents / 100, amountOverride: null })).toBe(legacy)
    }
  })

  it("sums the header total in cents so floats don't drift", () => {
    expect(purchaseOrderTotal([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3)
    expect(purchaseOrderTotal([{ amount: 59.97 }, { amount: 125 }, { amount: 0 }])).toBe(184.97)
    expect(purchaseOrderTotal([])).toBe(0)
  })

  it("never trusts a client total: the override is the only amount input", () => {
    const [normalized] = normalizePurchaseOrderLines([line({ quantity: 2, unitCost: 10 })], "PO")
    expect(normalized?.amount).toBe(20)
  })
})

describe("normalizePurchaseOrderLines", () => {
  it("drops empty lines and defaults quantity 1 and unit cost 0", () => {
    const lines = normalizePurchaseOrderLines(
      [line({ description: "  " }), line({ description: "Nails", unitCost: 4 })],
      "Fallback",
    )
    expect(lines).toEqual([
      {
        lineNumber: 2,
        description: "Nails",
        costCode: null,
        phaseCode: null,
        quantity: 1,
        unitCost: 4,
        unit: null,
        amount: 4,
        taxGroup: null,
      },
    ])
  })

  it("keeps one placeholder line when nothing meaningful was entered", () => {
    const lines = normalizePurchaseOrderLines([line({ description: null })], "Order title")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ lineNumber: 1, description: "Order title", quantity: 1, unitCost: 0, amount: 0 })
  })

  it("uses the fallback description for a coded line without one", () => {
    const [only] = normalizePurchaseOrderLines([line({ description: null, costCode: " 06-100 " })], "Order")
    expect(only).toMatchObject({ description: "Order", costCode: "06-100" })
  })

  it("carries a single line's codes up to the header", () => {
    const one = normalizePurchaseOrderLines([line({ costCode: "06", phaseCode: "06", taxGroup: "CO" })], "x")
    expect(purchaseOrderHeaderCodes(one)).toEqual({ costCode: "06", phaseCode: "06", taxGroup: "CO" })
    const two = normalizePurchaseOrderLines([line({ costCode: "06" }), line({ costCode: "07" })], "x")
    expect(purchaseOrderHeaderCodes(two)).toEqual({ costCode: null, phaseCode: null, taxGroup: null })
  })
})

describe("numbering", () => {
  it("numbers purchase orders from the project number", () => {
    expect(purchaseOrderRequestNumberFor("O-58-3674", 2, "abcdef12")).toBe("O-58-3674-PO-003")
    expect(purchaseOrderRequestNumberFor(null, 0, "abcdef12")).toBe("PO-REQ-001-ABCDEF")
  })

  it("numbers documents and the Sage short form", () => {
    expect(projectDocumentNumberFor("O-58-3674", "RFQ", 9)).toBe("O-58-3674-RFQ-010")
    expect(projectDocumentNumberFor(" ", "RFQ", 0)).toBe("RFQ-001")
    expect(sageShortProjectDocumentNumberFor("O-58-3674", "RFQ", 0)).toBe("O-58-RFQ-001")
    expect(sageShortProjectDocumentNumberFor("N58", "RFQ", 0)).toBe("N58-RFQ-001")
    expect(sageShortProjectDocumentNumberFor(null, "RFQ", 4)).toBe("RFQ-005")
  })

  it("numbers to-dos", () => {
    expect(projectTaskNumberFor(0)).toBe("TASK-001")
    expect(projectTaskNumberFor(1234)).toBe("TASK-1235")
  })
})

describe("input cleanup", () => {
  it("requires text", () => {
    expect(requireText("  Title ", "Title")).toBe("Title")
    expect(() => requireText("  ", "Title")).toThrow("Title is required")
  })

  it("validates calendar dates", () => {
    expect(cleanDate(" 2026-10-31 ", "Due date")).toBe("2026-10-31")
    expect(cleanDate("", "Due date")).toBeNull()
    expect(() => cleanDate("2026-02-30", "Due date")).toThrow("Due date must be a valid date")
    expect(() => cleanDate("10/31/2026", "Due date")).toThrow("Due date must be a valid date")
  })

  it("parses email lists", () => {
    expect(parseEmailList(" A@x.com; b@y.org, not-an-email c@z.io ")).toEqual(["a@x.com", "b@y.org", "c@z.io"])
    expect(parseEmailList(null)).toEqual([])
  })
})

describe("to-dos", () => {
  it("normalizes record and assignee types", () => {
    expect(normalizeTaskRecordType("supplier_task")).toBe("supplier_task")
    expect(assigneeTypeForTask("subcontractor_task")).toBe("subcontractor")
    expect(assigneeTypeForTask("schedule_task")).toBe("internal")
  })

  it("allows editing until archived, then restore and delete", () => {
    expect(todoActions({ status: "open" })).toEqual({ canEdit: true, canRestore: false })
    expect(todoActions({ status: "complete" })).toEqual({ canEdit: true, canRestore: false })
    expect(todoActions({ status: "archived" })).toEqual({ canEdit: false, canRestore: true })
    expect(todoActions({ status: "cancelled" })).toEqual({ canEdit: false, canRestore: true })
  })

  it("builds the history row with a trimmed note", () => {
    const row = todoEventRow({
      organizationId: "org",
      projectId: "p",
      todoId: "t",
      kind: "worked",
      dailyLogId: null,
      fromStatus: "open",
      toStatus: "in_progress",
      note: `  ${"x".repeat(600)}  `,
      actorId: "u",
      createdAt: "2026-10-31T00:00:00.000Z",
    })
    expect(row.note).toHaveLength(500)
    expect(row.createdAt).toBe("2026-10-31T00:00:00.000Z")
    expect(todoEventRow({ ...row, note: "   " }).note).toBeNull()
  })
})

describe("purchase-order and RFQ actions", () => {
  const draft = { sourceSystem: "compass", status: "draft", syncStatus: "pending_sage", sageWriteStatus: "draft_ready" }

  it("lets only an unsent Compass draft be edited", () => {
    expect(purchaseOrderActions(draft).canEdit).toBe(true)
    expect(purchaseOrderActions({ ...draft, status: "sent" }).canEdit).toBe(false)
    expect(purchaseOrderActions({ ...draft, syncStatus: "queued_sage" }).canEdit).toBe(false)
    expect(purchaseOrderActions({ ...draft, sourceSystem: "sage" }).canEdit).toBe(false)
  })

  it("derives RFQ actions from status, response, and template review", () => {
    expect(rfqActions({ status: "draft", vendorResponse: null, templateReview: null })).toEqual({
      canEdit: true,
      canDelete: true,
      canEmail: true,
      canRecordResponse: true,
      sharingMarksSent: true,
    })
    expect(rfqActions({ status: "sent", vendorResponse: null, templateReview: { unresolvedPlaceholders: ["X"] } })).toEqual({
      canEdit: true,
      canDelete: false,
      canEmail: false,
      canRecordResponse: true,
      sharingMarksSent: false,
    })
    expect(rfqActions({ status: "response_received", vendorResponse: { amount: 1 }, templateReview: null })).toEqual({
      canEdit: false,
      canDelete: false,
      canEmail: false,
      canRecordResponse: true,
      sharingMarksSent: false,
    })
    expect(rfqActions({ status: "awarded", vendorResponse: { amount: 1 }, templateReview: null }).canRecordResponse).toBe(false)
  })
})

describe("RFQ input", () => {
  it("normalizes scope lines with a fallback line", () => {
    expect(normalizeRfqScopeLines([{ description: " ", costCode: null, phaseCode: null, notes: null }], "Scope")).toEqual([
      { lineNumber: 1, description: "Scope", costCode: null, phaseCode: null, notes: null },
    ])
    expect(normalizeRfqScopeLines([{ description: null, costCode: "06", phaseCode: null, notes: null }], "Scope")).toEqual([
      { lineNumber: 1, description: "Scope", costCode: "06", phaseCode: null, notes: null },
    ])
  })

  it("requires a URL on each document link", () => {
    expect(normalizeRfqDocumentLinks([{ label: null, url: " https://x ", notes: null }])).toEqual([
      { lineNumber: 1, label: "Document 1", url: "https://x", notes: null },
    ])
    expect(normalizeRfqDocumentLinks([{ label: null, url: null, notes: null }])).toEqual([])
    expect(() => normalizeRfqDocumentLinks([{ label: "Plans", url: null, notes: null }])).toThrow(
      "Each RFQ document link needs a URL.",
    )
  })
})

describe("Sage queue", () => {
  it("maps record types to queue kinds", () => {
    expect(operationSyncKind("google_nutech_order")).toBe("purchase_order")
    expect(operationSyncKind("google_script_handoff")).toBe("google_handoff")
    expect(operationSyncKind("staff_task")).toBe("task")
  })

  it("queues only write rows that are ready", () => {
    const ready = { syncDirection: "write", syncStatus: "pending_sage", sageWriteStatus: "draft_ready" }
    expect(operationCanQueueForSage(ready)).toBe(true)
    expect(operationCanQueueForSage({ ...ready, syncDirection: "read" })).toBe(false)
    expect(operationCanQueueForSage({ ...ready, syncStatus: "synced" })).toBe(false)
    expect(operationCanQueueForSage({ ...ready, sageWriteStatus: "not_ready" })).toBe(false)
    expect(operationCanQueueForSage({ ...ready, syncStatus: "mapped" })).toBe(false)
  })

  it("classifies queue rows", () => {
    expect(syncQueueStatus({ syncStatus: "syncing", sageWriteStatus: null, syncDirection: "read" })).toBe("queued")
    expect(syncQueueStatus({ syncStatus: "pending", sageWriteStatus: null, syncDirection: "read" })).toBe("blocked")
    expect(syncQueueStatus({ syncStatus: "pending", sageWriteStatus: "draft_ready", syncDirection: "write" })).toBe("ready")
  })
})
