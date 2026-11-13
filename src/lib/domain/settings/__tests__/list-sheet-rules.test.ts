import { describe, expect, it } from "vitest"

import { LIST_SHEETS, listSheetDefinition, type ListSheetDefinition } from "../list-sheet-registry"
import {
  type CompanyListSheetSetting,
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
    const company: CompanyListSheetSetting = {
      columns: [
        { id: "number", visible: true },
        { id: "status", visible: true },
        { id: "title", visible: false },
        { id: "contact", visible: true },
        { id: "due", visible: true },
        { id: "docs", visible: true },
      ],
      sort: { kind: "column", columnId: "status", desc: true },
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
      { columns: [{ id: "number", visible: false }], sort: { kind: "default" }, startFilter: null },
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
        sort: { kind: "column", columnId: "removed", desc: false },
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

  it("falls back to the default sort when the sort column is hidden personally", () => {
    const company = { columns: sheet.columns.map((column) => ({ id: column.id, visible: true })), sort: { kind: "column" as const, columnId: "status", desc: false }, startFilter: null }
    expect(resolveListSheetLayout(sheet, company, null).sort).toEqual({ columnId: "status", desc: false })
    expect(resolveListSheetLayout(sheet, company, { hiddenColumnIds: ["status"], shownColumnIds: [] }).sort).toEqual(sheet.defaultSort)
    // With the default's column hidden too, the list keeps its own order.
    expect(resolveListSheetLayout(sheet, company, { hiddenColumnIds: ["status", "due"], shownColumnIds: [] }).sort).toBeNull()
  })

  it("ignores company layouts on personal-only sheets", () => {
    const personalOnly: ListSheetDefinition = { ...sheet, personalOnly: true }
    const layout = resolveListSheetLayout(personalOnly, { columns: [{ id: "title", visible: false }], sort: { kind: "none" }, startFilter: "all" }, null)
    expect(visibleIds(layout)).toEqual(["number", "title", "status", "due", "docs"])
    expect(layout.sort).toEqual(sheet.defaultSort)
    expect(checkCompanyListSheet(personalOnly, { sheetId: sheet.id, columns: sheet.columns.map((column) => ({ id: column.id, visible: true })), sort: null, startFilter: null }).ok).toBe(false)
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
      .toEqual({ ok: true, value: { columns: all, sort: { kind: "column", columnId: "due", desc: true }, startFilter: "all", filterLabels: {} } })
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: [...all, { id: "extra", visible: true }], sort: null, startFilter: null }).ok).toBe(false)
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: [...all, { id: "due", visible: true }], sort: null, startFilter: null }).ok).toBe(false)
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: all.slice(1), sort: null, startFilter: null }).ok).toBe(false)
  })

  it("refuses an unsortable sort column and an unknown filter", () => {
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: all, sort: { columnId: "docs", direction: "asc" }, startFilter: null }).ok).toBe(false)
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: all, sort: null, startFilter: "draft" }).ok).toBe(false)
  })

  it("stores a sort or filter equal to the code default as following the default", () => {
    const checked = checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: all, sort: { columnId: "due", direction: "asc" }, startFilter: "open" })
    expect(checked).toEqual({ ok: true, value: { columns: all, sort: { kind: "default" }, startFilter: null, filterLabels: {} } })
    // "The list's own order" is its own stored value, distinct from the default.
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns: all, sort: null, startFilter: null }))
      .toEqual({ ok: true, value: { columns: all, sort: { kind: "none" }, startFilter: null, filterLabels: {} } })
    // A later code default change reaches a company that saved the default.
    const changed: ListSheetDefinition = { ...sheet, defaultSort: { columnId: "status", desc: true }, startFilter: sheet.startFilter && { ...sheet.startFilter, defaultValue: "all" } }
    if (!checked.ok) throw new Error("expected a valid layout")
    const layout = resolveListSheetLayout(changed, checked.value, null)
    expect(layout.sort).toEqual({ columnId: "status", desc: true })
    expect(layout.startFilter).toBe("all")
    expect(resolveListSheetLayout(changed, { columns: all, sort: { kind: "none" }, startFilter: null }, null).sort).toBeNull()
  })

  it("refuses a sort on a hidden column", () => {
    const columns = all.map((column) => ({ ...column, visible: column.id !== "status" }))
    expect(checkCompanyListSheet(sheet, { sheetId: sheet.id, columns, sort: { columnId: "status", direction: "asc" }, startFilter: null }))
      .toEqual({ ok: false, error: "Show the column the sheet sorts by, or choose another sort." })
  })

  it("refuses an input that names an organization", () => {
    expect(companyListSheetInputSchema.safeParse({ sheetId: sheet.id, columns: all, sort: null, startFilter: null, organizationId: "org-b" }).success).toBe(false)
  })

  it("stores renamed filters only on renamable sheets, dropping blanks and built-in names", () => {
    const renamable: ListSheetDefinition = { ...sheet, startFilter: sheet.startFilter && { ...sheet.startFilter, renamable: true } }
    const input = { sheetId: sheet.id, columns: all, sort: null, startFilter: null }
    expect(checkCompanyListSheet(renamable, { ...input, filterLabels: { open: "Active", all: "All" } }))
      .toMatchObject({ ok: true, value: { filterLabels: { open: "Active" } } })
    expect(checkCompanyListSheet(renamable, { ...input, filterLabels: { open: "" } })).toMatchObject({ ok: true, value: { filterLabels: {} } })
    expect(checkCompanyListSheet(renamable, { ...input, filterLabels: { gone: "Gone" } }).ok).toBe(false)
    expect(checkCompanyListSheet(renamable, { ...input, filterLabels: { open: "all" } })).toEqual({ ok: false, error: "Give each filter a different name." })
    expect(checkCompanyListSheet(sheet, { ...input, filterLabels: { open: "Active" } }).ok).toBe(false)
  })

  it("names each filter button by the company's name, else the built-in one", () => {
    const renamable: ListSheetDefinition = { ...sheet, startFilter: sheet.startFilter && { ...sheet.startFilter, renamable: true } }
    const company = { columns: all, sort: { kind: "default" as const }, startFilter: null, filterLabels: { open: "Active" } }
    expect(resolveListSheetLayout(renamable, company, null).filterLabels).toEqual({ open: "Active", all: "All" })
    // A sheet that stops being renamable falls back to the built-in names.
    expect(resolveListSheetLayout(sheet, company, null).filterLabels).toEqual({ open: "Open", all: "All" })
  })
})

describe("TanStack options", () => {
  it("keeps unregistered columns in place and orders registered ones", () => {
    const layout = resolveListSheetLayout(
      sheet,
      { columns: ["number", "due", "title", "status", "contact", "docs"].map((id) => ({ id, visible: id !== "status" })), sort: { kind: "default" }, startFilter: null },
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
