import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  orgContext: vi.fn(),
  read: vi.fn(),
  saveCompany: vi.fn(),
  resetCompany: vi.fn(),
  savePersonal: vi.fn(),
  deletePersonal: vi.fn(),
  activity: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock("@/lib/server/action-context", () => ({ orgContext: mocks.orgContext }))
vi.mock("@/lib/domain/settings/list-sheets", () => ({ readListSheetPreferences: mocks.read }))
vi.mock("@/lib/domain/settings/store", () => ({
  saveOrganizationListSheetSetting: mocks.saveCompany,
  deleteOrganizationListSheetSetting: mocks.resetCompany,
  saveUserListSheetColumnPreference: mocks.savePersonal,
  deleteUserListSheetColumnPreference: mocks.deletePersonal,
}))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.activity }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))

import { resetCompanyListSheet, saveCompanyListSheet, savePersonalListSheetColumns } from "@/app/actions/list-sheets"
import { listSheetDefinition } from "@/lib/domain/settings/list-sheet-registry"

const db = { name: "db" }

function signedIn(role: string): void {
  mocks.orgContext.mockResolvedValue({
    success: true,
    data: {
      db,
      organizationId: "org-a",
      env: {},
      user: { id: "user-a", email: "a@example.com", displayName: "A", role, isActive: true, organizationId: "org-a" },
    },
  })
}

function poColumns(): { readonly id: string; readonly visible: boolean }[] {
  const definition = listSheetDefinition("purchase-orders.job")
  if (!definition) throw new Error("missing sheet")
  return definition.columns.map((column) => ({ id: column.id, visible: column.id !== "siteContact" }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockResolvedValue({ company: {}, personal: {} })
})

describe("company list sheet settings", () => {
  it("saves for the admin's own organization and logs it to Activity", async () => {
    signedIn("admin")
    const result = await saveCompanyListSheet({
      sheetId: "purchase-orders.job",
      columns: poColumns(),
      sort: { columnId: "amount", direction: "desc" },
      startFilter: "all",
    })
    expect(result).toEqual({ success: true, data: null })
    expect(mocks.orgContext).toHaveBeenCalledWith({ mutation: true })
    expect(mocks.saveCompany).toHaveBeenCalledWith(db, expect.objectContaining({
      organizationId: "org-a",
      sheetKey: "purchase-orders.job",
      sortColumn: "amount",
      sortDirection: "desc",
      startFilter: "all",
      updatedBy: "user-a",
    }))
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-a",
      category: "settings",
      action: "updated",
      entityType: "list_sheet",
      entityId: "purchase-orders.job",
    }))
  })

  it("refuses a write aimed at another organization", async () => {
    signedIn("admin")
    const result = await saveCompanyListSheet({
      sheetId: "purchase-orders.job",
      columns: poColumns(),
      sort: null,
      startFilter: null,
      organizationId: "org-b",
    })
    expect(result.success).toBe(false)
    expect(mocks.saveCompany).not.toHaveBeenCalled()
  })

  it("refuses staff who are not company settings admins", async () => {
    signedIn("project_manager")
    const result = await saveCompanyListSheet({ sheetId: "purchase-orders.job", columns: poColumns(), sort: null, startFilter: null })
    expect(result).toEqual({ success: false, error: "Only admins can change company settings." })
    expect(await resetCompanyListSheet("purchase-orders.job")).toEqual({ success: false, error: "Only admins can change company settings." })
    expect(mocks.saveCompany).not.toHaveBeenCalled()
    expect(mocks.resetCompany).not.toHaveBeenCalled()
  })

  it("refuses an unknown sheet and a hidden required column", async () => {
    signedIn("admin")
    expect((await saveCompanyListSheet({ sheetId: "nope", columns: [], sort: null, startFilter: null })).success).toBe(false)
    const columns = poColumns().map((column) => (column.id === "number" ? { ...column, visible: false } : column))
    expect((await saveCompanyListSheet({ sheetId: "purchase-orders.job", columns, sort: null, startFilter: null })).success).toBe(false)
    expect(mocks.saveCompany).not.toHaveBeenCalled()
  })

  it("resets one sheet for the admin's organization", async () => {
    signedIn("admin")
    expect(await resetCompanyListSheet("rfis.job")).toEqual({ success: true, data: null })
    expect(mocks.resetCompany).toHaveBeenCalledWith(db, "org-a", "rfis.job")
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "reset", entityId: "rfis.job" }))
  })
})

describe("personal columns", () => {
  it("saves for the signed-in person only, dropping unknown and required columns", async () => {
    signedIn("field_staff")
    const result = await savePersonalListSheetColumns({
      sheetId: "purchase-orders.job",
      hiddenColumnIds: ["number", "vendor", "gone"],
      shownColumnIds: [],
    })
    expect(result.success).toBe(true)
    expect(mocks.savePersonal).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "user-a",
      organizationId: "org-a",
      sheetKey: "purchase-orders.job",
      hiddenColumnIds: JSON.stringify(["vendor"]),
      shownColumnIds: "[]",
    }))
  })

  it("deletes the row when nothing differs from the company layout", async () => {
    signedIn("field_staff")
    await savePersonalListSheetColumns({ sheetId: "todos.job", hiddenColumnIds: [], shownColumnIds: [] })
    expect(mocks.deletePersonal).toHaveBeenCalledWith(db, { userId: "user-a", organizationId: "org-a", sheetKey: "todos.job" })
    expect(mocks.savePersonal).not.toHaveBeenCalled()
  })

  it("refuses a payload naming another user or organization", async () => {
    signedIn("field_staff")
    const result = await savePersonalListSheetColumns({ sheetId: "todos.job", hiddenColumnIds: ["author"], shownColumnIds: [], userId: "user-b" })
    expect(result.success).toBe(false)
    expect(mocks.savePersonal).not.toHaveBeenCalled()
  })
})
