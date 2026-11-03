import { describe, expect, it } from "vitest"

import {
  ALL,
  EMPTY_SELECTION_FILTERS,
  categoryMatches,
  contactTypeLabel,
  divisionForSelection,
  filtersWithDivision,
  lineFromSelection,
  lineHasContent,
  lineWithCostCode,
  lineWithDivision,
  newLine,
  normalizeChoice,
  optionMatches,
  selectionMatchesFilters,
  selectionStatusLabel,
  toDocumentInput,
  toScopeInput,
} from "@/components/projects/rfq-create/rfq-draft"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type { ProjectRfqCostCodeOption } from "@/lib/domain/operations/types"
import type { ProjectSelectionItem, ProjectSelectionOptions } from "@/lib/domain/selections/types"

const costCodes: readonly ProjectRfqCostCodeOption[] = [
  { value: "08-500", label: "Windows", description: "", divisionCode: "08", divisionLabel: "08 Openings" },
  { value: "09-200", label: "Tile", description: "", divisionCode: "09", divisionLabel: "09 Finishes" },
]

const selectionOptions: ProjectSelectionOptions = {
  roomTypes: [],
  manufacturers: [],
  divisions: [],
  costCodes: costCodes.map((code) => ({ ...code, source: "sage", needsSageReview: false })),
}

function selection(overrides: Partial<ProjectSelectionItem> = {}): ProjectSelectionItem {
  return {
    id: "sel-1",
    projectId: "p1",
    sourceSystem: "compass",
    sourceRecordId: null,
    sourceWorkbookId: null,
    sourceSheetName: null,
    roomName: "Kitchen",
    roomType: null,
    category: "Tile",
    name: "Backsplash",
    description: null,
    quantity: null,
    manufacturer: "Daltile",
    model: null,
    colorFinish: "White",
    choiceOptions: [],
    parentSelectionId: null,
    parentChoiceValue: null,
    selectionLevel: 0,
    supplierName: null,
    productUrl: null,
    costCode: "09-200",
    phaseCode: null,
    status: "owner_review",
    ownerVisible: true,
    ownerApproved: false,
    rfqOperationId: null,
    purchaseOrderOperationId: null,
    notes: null,
    syncStatus: "synced",
    updatedAt: "2026-10-31T00:00:00Z",
    ...overrides,
  }
}

describe("rfq draft rows", () => {
  it("builds a scope row from a finish selection", () => {
    const row = lineFromSelection(selection(), costCodes)
    expect(row).toMatchObject({
      selectionId: "sel-1",
      description: "Kitchen: Backsplash",
      phaseCode: "09",
      costCode: "09-200",
      notes: "Manufacturer: Daltile | Finish: White",
    })
  })

  it("falls back to the selection's phase code for unknown cost codes", () => {
    expect(lineFromSelection(selection({ costCode: "99-1", phaseCode: "99" }), costCodes).phaseCode).toBe("99")
  })

  it("trims inputs to null", () => {
    const row = { ...newLine(), description: "  Windows ", notes: "   " }
    expect(toScopeInput(row)).toEqual({ selectionId: null, description: "Windows", phaseCode: null, costCode: null, notes: null })
    expect(toDocumentInput({ id: "d", label: " Plans ", url: "", notes: "" })).toEqual({ label: "Plans", url: null, notes: null })
  })

  it("knows when a row has content", () => {
    expect(lineHasContent(newLine())).toBe(false)
    expect(lineHasContent({ ...newLine(), costCode: "08-500" })).toBe(true)
  })

  it("keeps a cost code only inside its division", () => {
    const row = { ...newLine(), phaseCode: "08", costCode: "08-500" }
    expect(lineWithDivision(row, "08", costCodes).costCode).toBe("08-500")
    expect(lineWithDivision(row, "09", costCodes)).toMatchObject({ phaseCode: "09", costCode: "" })
  })

  it("moves the division with the cost code", () => {
    const row = { ...newLine(), phaseCode: "08" }
    expect(lineWithCostCode(row, "09-200", costCodes)).toMatchObject({ phaseCode: "09", costCode: "09-200" })
    expect(lineWithCostCode(row, "zz", costCodes)).toMatchObject({ phaseCode: "08", costCode: "zz" })
  })
})

describe("rfq matching and labels", () => {
  it("normalizes queries", () => {
    expect(normalizeChoice("  Doors & Windows! ")).toBe("doors windows")
  })

  it("matches recipients on name, company, email and type", () => {
    const option: ProjectTaskAssigneeOption = {
      id: "c1",
      name: "Pat Lee",
      label: "Pat Lee",
      companyName: "Peak Glass",
      email: "pat@peak.test",
      contactType: "supplier",
      phone: null,
      source: "project",
      projectContactId: "pc1",
      directoryContactId: null,
      projectAccess: true,
    }
    expect(optionMatches(option, "")).toBe(true)
    expect(optionMatches(option, normalizeChoice("peak glass"))).toBe(true)
    expect(optionMatches(option, "nobody")).toBe(false)
  })

  it("matches categories on label and division", () => {
    expect(categoryMatches({ label: "Glazing", division: "08" }, "08")).toBe(true)
    expect(categoryMatches({ label: "Glazing", division: null }, "tile")).toBe(false)
  })

  it("labels contact types and statuses", () => {
    expect(contactTypeLabel("subcontractor")).toBe("Subcontractor")
    expect(contactTypeLabel("other")).toBe("other")
    expect(selectionStatusLabel("owner_review")).toBe("Owner Review")
  })
})

describe("rfq selection filters", () => {
  it("finds a selection's division", () => {
    expect(divisionForSelection(selection(), selectionOptions)).toBe("09")
    expect(divisionForSelection(selection({ costCode: "26-100" }), selectionOptions)).toBe("26")
    expect(divisionForSelection(selection({ costCode: null }), selectionOptions)).toBeNull()
  })

  it("filters by room, cost code and division", () => {
    const item = selection()
    const match = (filters: typeof EMPTY_SELECTION_FILTERS): boolean =>
      selectionMatchesFilters({ filters, options: selectionOptions, selection: item })
    expect(match(EMPTY_SELECTION_FILTERS)).toBe(true)
    expect(match({ ...EMPTY_SELECTION_FILTERS, roomName: "Bath" })).toBe(false)
    expect(match({ ...EMPTY_SELECTION_FILTERS, costCode: "08-500" })).toBe(false)
    expect(match({ ...EMPTY_SELECTION_FILTERS, division: "09" })).toBe(true)
    expect(match({ ...EMPTY_SELECTION_FILTERS, division: "08" })).toBe(false)
  })

  it("keeps the cost-code filter only when it fits the division", () => {
    const current = { ...EMPTY_SELECTION_FILTERS, costCode: "09-200" }
    expect(filtersWithDivision(current, "09", selectionOptions.costCodes).costCode).toBe("09-200")
    expect(filtersWithDivision(current, "08", selectionOptions.costCodes)).toMatchObject({ division: "08", costCode: ALL })
    expect(filtersWithDivision(current, ALL, selectionOptions.costCodes).costCode).toBe("09-200")
  })
})
