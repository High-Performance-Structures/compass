import { describe, expect, it } from "vitest"

import type { projectFinishSelections } from "@/db/schema"
import {
  buildSelectionOptions,
  changedNumberField,
  changedTextField,
  compassSelectionRoomId,
  finishSchedulePreview,
  importedSelectionIdentity,
  matchImportedSelection,
  normalizedChoiceOptions,
  normalizeStatus,
  parseQuantity,
  projectTaskNumberFor,
  quotedSheetRange,
  requiredText,
  summarizeSelections,
  toSelectionItem,
} from "@/lib/domain/selections/rules"

type Row = typeof projectFinishSelections.$inferSelect

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "s1",
    projectId: "p1",
    sourceSystem: "google_sheets",
    sourceRecordId: null,
    sourceWorkbookId: "wb",
    sourceSheetName: "Kitchen",
    roomName: "Kitchen",
    roomType: null,
    category: "Plumbing",
    name: "Faucet",
    description: null,
    quantity: null,
    manufacturer: null,
    model: null,
    colorFinish: null,
    choiceOptionsJson: null,
    parentSelectionId: null,
    parentChoiceValue: null,
    selectionLevel: 0,
    supplierName: null,
    productUrl: null,
    costCode: null,
    phaseCode: null,
    status: "needed",
    ownerVisible: false,
    ownerApproved: false,
    approvedBy: null,
    approvedAt: null,
    rfqOperationId: null,
    purchaseOrderOperationId: null,
    notes: null,
    sortOrder: 0,
    syncStatus: "imported",
    lastSyncedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("selection input rules", () => {
  it("validates text, status and quantity as before", () => {
    expect(() => requiredText("  ", "Room")).toThrow("Room is required")
    expect(requiredText(" Kitchen ", "Room")).toBe("Kitchen")
    expect(normalizeStatus("approved")).toBe("approved")
    expect(normalizeStatus("bogus")).toBe("needed")
    expect(normalizeStatus(null)).toBe("needed")
    expect(parseQuantity(" 2.5 ")).toBe(2.5)
    expect(parseQuantity("")).toBeNull()
    expect(() => parseQuantity("-1")).toThrow("Quantity must be a positive number.")
  })

  it("dedupes choices and enforces the limits", () => {
    expect(normalizedChoiceOptions([" a ", "a", "", "b"])).toEqual(["a", "b"])
    expect(normalizedChoiceOptions(undefined)).toEqual([])
    expect(() => normalizedChoiceOptions(["x".repeat(201)])).toThrow(
      "Template selection choices must be 200 characters or less."
    )
  })

  it("builds room ids, task numbers and sheet ranges", () => {
    expect(compassSelectionRoomId("p1", "Main Bath / 2")).toBe("selection-room-p1-main-bath-2")
    expect(projectTaskNumberFor(0)).toBe("TASK-001")
    expect(projectTaskNumberFor(41)).toBe("TASK-042")
    expect(quotedSheetRange("Bob's Room", "A:G")).toBe("'Bob''s Room'!A:G")
  })

  it("reports normalized field changes only", () => {
    expect(changedTextField("Room", " Kitchen", "Kitchen ")).toBeNull()
    expect(changedTextField("Room", null, "Bath")).toEqual({ field: "Room", before: "", after: "Bath" })
    expect(changedNumberField("Quantity", 1, null)).toEqual({ field: "Quantity", before: "1", after: "" })
  })
})

describe("selection read model", () => {
  it("parses choices and groups selections into rooms with counts", () => {
    // A legacy stored value outside the list still reads as "needed".
    const item = toSelectionItem(Object.assign(row({ choiceOptionsJson: '["A"," ",3]' }), { status: "weird" }))
    expect(item.choiceOptions).toEqual(["A"])
    expect(item.status).toBe("needed")
    const summary = summarizeSelections(
      [],
      [item, toSelectionItem(row({ id: "s2", roomName: "Bath", status: "ordered" }))]
    )
    expect(summary.totalCount).toBe(2)
    expect(summary.rooms.map((room) => room.roomName)).toEqual(["Kitchen", "Bath"])
    expect(summary.needsDecisionCount).toBe(1)
    expect(summary.orderedCount).toBe(1)
    expect(summary.sourceWorkbookCount).toBe(1)
  })

  it("builds picker options from cost codes, contacts and selections", () => {
    const options = buildSelectionOptions({
      costCodes: [],
      contacts: [
        { companyName: "Acme Supply", displayName: null, contactType: "supplier", csiDivision: "22", csiDivisionName: "Plumbing" },
      ],
      selections: [{ manufacturer: "Zed", supplierName: null, costCode: "2210", category: "Plumbing" }],
    })
    expect(options.divisions).toEqual([{ value: "22", label: "22 00 00 Plumbing" }])
    expect(options.costCodes[0]).toMatchObject({
      value: "2210",
      label: "2210 Plumbing selection",
      source: "selection",
      needsSageReview: true,
    })
    expect(options.manufacturers.map((option) => option.value)).toContain("Acme Supply")
    expect(options.manufacturers.map((option) => option.value)).toContain("Zed")
  })
})

describe("finish-schedule import rules", () => {
  it("previews a project-number match, mismatch or unknown", () => {
    const loaded = (projectNumber: string | null) => ({
      workbookId: "wb",
      workbookTitle: "Finish schedule",
      parsed: { projectNumber, rooms: [], selections: [], warnings: [] },
    })
    expect(finishSchedulePreview(loaded("O-58-1"), "O-58-1").projectMatch).toBe("match")
    const mismatch = finishSchedulePreview(loaded("O-58-1"), "O-58-2")
    expect(mismatch.projectMatch).toBe("mismatch")
    expect(mismatch.warnings).toEqual([
      "Workbook project O-58-1 does not match Compass project O-58-2.",
    ])
    expect(finishSchedulePreview(loaded(null), "O-58-2").projectMatch).toBe("unknown")
  })

  it("matches an incoming row to the same row, a moved row, or a renamed row", () => {
    const existing = row({ id: "old", sourceRecordId: "wb:1:5" })
    const identity = importedSelectionIdentity(existing)
    // Same source row and identity.
    expect(
      matchImportedSelection({
        identity,
        exactMatch: existing,
        identityMatches: [existing],
        usedSelectionIds: new Set(),
        incomingIdentities: new Set([identity]),
      })?.id
    ).toBe("old")
    // Renamed in place: the old identity is gone from the workbook.
    expect(
      matchImportedSelection({
        identity: "kitchen|plumbing|sink",
        exactMatch: existing,
        identityMatches: [],
        usedSelectionIds: new Set(),
        incomingIdentities: new Set(["kitchen|plumbing|sink"]),
      })?.id
    ).toBe("old")
    // The old identity still exists elsewhere: this is a new row.
    expect(
      matchImportedSelection({
        identity: "kitchen|plumbing|sink",
        exactMatch: existing,
        identityMatches: [],
        usedSelectionIds: new Set(),
        incomingIdentities: new Set(["kitchen|plumbing|sink", identity]),
      })
    ).toBeNull()
    // Already used by an earlier row.
    expect(
      matchImportedSelection({
        identity,
        exactMatch: existing,
        identityMatches: [existing],
        usedSelectionIds: new Set(["old"]),
        incomingIdentities: new Set([identity]),
      })
    ).toBeNull()
  })
})
