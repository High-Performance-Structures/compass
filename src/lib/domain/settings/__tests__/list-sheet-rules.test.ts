import { describe, expect, it } from "vitest"

import { LIST_SHEETS, listSheetDefinition, type ListSheetDefinition } from "../list-sheet-registry"
import {
  checkCompanyListSheet,
  checkPersonalListSheet,
  companyListSheetInputSchema,
  listSheetColumnOrder,
  listSheetColumnVisibility,
  nextPersonalPreference,
  parseStoredJson,
  listSheetColumnsSchema,
  resolveListSheetLayout,
} from "../list-sheet-rules"

const sheet: ListSheetDefinition = {
  id: "test.sheet",
  label: "Test",
  where: "Tests",
  columns: [
    { id: "number", label: "Number", kind: "text", required: true },
    { id: "title", label: "Title", kind: "text" },
    { id: "status", label: "Status", kind: "status" },
    { id: "contact", label: "Contact", kind: "text", hiddenByDefault: true },
    { id: "due", label: "Due", kind: "date" },
    { id: "docs", label: "Docs", kind: "text", sortable: false },
  ],
  defaultSort: { columnId: "due", desc: false },
  startFilter: { options: [{ value: "open", label: "Open" }, { value: "all", label: "All" }], defaultValue: "open" },
}

const visibleIds = (layout: ReturnType<typeof resolveListSheetLayout>): readonly string[] =>
  layout.columns.filter((column) => column.visible).map((column) => column.id)

describe("list sheet layout precedence", () => {
  it("uses the code default without company or personal settings", () => {
    const layout = resolveListSheetLayout(sheet, null, null)
    expect(visibleIds(layout)).toEqual(["number", "title", "status", "due", "docs"])
    expect(layout.sort).toEqual({ columnId: "due", desc: false })
    expect(layout.startFilter).toBe("open")
    expect(layout.personalized).toBe(false)
  })

  it("applies the company over the default and the person over the company", () => {
    const company = {
      columns: [
        { id: "number", visible: true },
        { id: "status", visible: true },
        { id: "title", visible: false },
        { id: "contact", visible: true },
        { id: "due", visible: true },
        { id: "docs", visible: true },
      ],
      sort: { columnId: "status", desc: true },
      startFilter: "all",
    }
    const companyLayout = resolveListSheetLayout(sheet, company, null)
    expect(visibleIds(companyLayout)).toEqual(["number", "status", "contact", "due", "docs"])
    expect(companyLayout.sort).toEqual({ columnId: "status", desc: true })
    expect(companyLayout.startFilter).toBe("all")

    const personal = { hiddenColumnIds: ["contact"], shownColumnIds: ["title"] }
    const layout = resolveListSheetLayout(sheet, company, personal)
    expect(visibleIds(layout)).toEqual(["number", "status", "title", "due", "docs"])
    expect(layout.personalized).toBe(true)
    // The person changes visibility only; order and sort stay the company's.
    expect(layout.columns.map((column) => column.id)).toEqual(companyLayout.columns.map((column) => column.id))
    expect(layout.sort).toEqual(companyLayout.sort)
  })

  it("never hides the required column, whoever asks", () => {
    const layout = resolveListSheetLayout(
      sheet,
      { columns: [{ id: "number", visible: false }], sort: null, startFilter: null },
      { hiddenColumnIds: ["number"], shownColumnIds: [] },
    )
    expect(layout.columns.find((column) => column.id === "number")?.visible).toBe(true)
    expect(nextPersonalPreference(layout, null, "number", false)).toEqual({ hiddenColumnIds: [], shownColumnIds: [] })
    expect(checkPersonalListSheet(sheet, { sheetId: sheet.id, hiddenColumnIds: ["number", "title"], shownColumnIds: [] }))
      .toEqual({ hiddenColumnIds: ["title"], shownColumnIds: [] })
    expect(checkCompanyListSheet(sheet, {
      sheetId: sheet.id,
      columns: sheet.columns.map((column) => ({ id: column.id, visible: column.id !== "number" })),
      sort: null,
      startFilter: null,
    })).toEqual({ ok: false, error: "Number is always shown because it opens the record." })
  })

  it("ignores unknown ids and places columns added to code later", () => {
    const layout = resolveListSheetLayout(
      sheet,
      {
        // Saved before "contact" and "docs" existed, with a column since removed.
        columns: [{ id: "removed", visible: true }, { id: "due", visible: true }, { id: "number", visible: true }, { id: "title", visible: false }, { id: "status", visible: true }],
        sort: { columnId: "removed", desc: false },
        startFilter: "gone",
      },
      { hiddenColumnIds: ["also-removed"], shownColumnIds: ["nope"] },
    )
    // New columns follow the column before them in code: contact after status, docs after due.
    expect(layout.columns.map((column) => column.id)).toEqual(["due", "docs", "number", "title", "status", "contact"])
    expect(visibleIds(layout)).toEqual(["due", "docs", "number", "status"])
    // An unknown sort column or filter falls back to the code default.
    expect(layout.sort).toEqual(sheet.defaultSort)
    expect(layout.startFilter).toBe("open")
    expect(layout.personalized).toBe(false)
    expect(checkPersonalListSheet(sheet, { sheetId: sheet.id, hiddenColumnIds: ["nope"], shownColumnIds: ["also"] }))
      .toEqual({ hiddenColumnIds: [], shownColumnIds: [] })
  })

  it("drops a personal choice that matches the company, so later company changes apply", () => {
    const layout = resolveListSheetLayout(sheet, null, null)
    const hidden = nextPersonalPreference(layout, null, "title", false)
    expect(hidden).toEqual({ hiddenColumnIds: ["title"], shownColumnIds: [] })
    const shownContact = nextPersonalPreference(layout, hidden, "contact", true)
    expect(shownContact).toEqual({ hiddenColumnIds: ["title"], shownColumnIds: ["contact"] })
    const back = nextPersonalPreference(resolveListSheetLayout(sheet, null, shownContact), shownContact, "title", true)
    expect(back).toEqual({ hiddenColumnIds: [], shownColumnIds: ["contact"] })
  })

  it("reads malformed stored JSON as empty", () => {
    expect(parseStoredJson("{not json", listSheetColumnsSchema)).toBeNull()
    expect(parseStoredJson(JSON.stringify([{ id: "a", visible: "yes" }]), listSheetColumnsSchema)).toBeNull()
  })
})

describe("company layout checks", () => {
  const all = sheet.columns.map((column) => ({ id: column.id, visible: true }))

  it("accepts a full layout and refuses unknown, repeated or missing columns", () => {
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: all, sort: { columnId: "due", direction: "desc" }, startFilter: "all" }))
      .toEqual({ ok: true, value: { columns: all, sort: { columnId: "due", desc: true }, startFilter: "all" } })
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: [...all, { id: "extra", visible: true }], sort: null, startFilter: null }).ok).toBe(false)
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: [...all, { id: "due", visible: true }], sort: null, startFilter: null }).ok).toBe(false)
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: all.slice(1), sort: null, startFilter: null }).ok).toBe(false)
  })

  it("refuses an unsortable sort column and an unknown filter", () => {
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: all, sort: { columnId: "docs", direction: "asc" }, startFilter: null }).ok).toBe(false)
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: all, sort: null, startFilter: "draft" }).ok).toBe(false)
  })

  it("refuses an input that names an organization", () => {
    expect(companyListSheetInputSchema.safeParse({ sheetId: sheet.id, columns: all, sort: null, startFilter: null, organizationId: "org-b" }).success).toBe(false)
  })
})

describe("TanStack options", () => {
  it("keeps unregistered columns in place and orders registered ones", () => {
    const layout = resolveListSheetLayout(
      sheet,
      { columns: ["number", "due", "title", "status", "contact", "docs"].map((id) => ({ id, visible: id !== "status" })), sort: null, startFilter: null },
      null,
    )
    expect(listSheetColumnOrder(layout, ["select", "number", "title", "status", "source", "due", "actions"]))
      .toEqual(["select", "number", "due", "title", "source", "status", "actions"])
    expect(listSheetColumnVisibility(layout)).toEqual({ status: false })
  })
})

describe("registry", () => {
  it("gives every sheet a unique id, unique columns and exactly one required column", () => {
    expect(new Set(LIST_SHEETS.map((entry) => entry.id)).size).toBe(LIST_SHEETS.length)
    for (const entry of LIST_SHEETS) {
      const ids = entry.columns.map((column) => column.id)
      expect(new Set(ids).size, entry.id).toBe(ids.length)
      expect(entry.columns.filter((column) => column.required).length, entry.id).toBe(1)
      if (entry.defaultSort) expect(ids, entry.id).toContain(entry.defaultSort.columnId)
      if (entry.startFilter) expect(entry.startFilter.options.map((option) => option.value), entry.id).toContain(entry.startFilter.defaultValue)
    }
    expect(listSheetDefinition("missing")).toBeNull()
  })
})
