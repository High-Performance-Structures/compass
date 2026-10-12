import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getCloudflareContext: vi.fn() }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser, requireAuth: mocks.getCurrentUser }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/app/actions/project-travel-charges", () => ({ getProjectTravelCharge: vi.fn().mockResolvedValue(null) }))

import {
  createRateBookEntry,
  deleteRateBookEntry,
  getRateBookHistory,
  getRateBookPicker,
  listRateBookEntries,
  setRateBookEntryStatus,
  updateRateBookEntry,
} from "../rate-book"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"

let database: CorrespondenceTestDatabase | null = null
afterEach(() => {
  database?.close()
  database = null
  vi.clearAllMocks()
})

const input = {
  name: "Delivery truck with driver",
  category: "delivery",
  unit: "hr",
  unitCostCents: 9500,
  markupBasisPoints: 1000,
  divisionCode: null,
  divisionName: null,
  costCode: null,
  costCodeName: null,
  fuelType: "diesel",
  fuelGallonsPerUnit: 4,
  notes: "Two-hour minimum",
}

function open(role = "admin"): CorrespondenceTestDatabase {
  const opened = openCorrespondenceTestDatabase()
  opened.sqlite.exec("CREATE TABLE project_estimate_line_cost_items (id TEXT PRIMARY KEY, deleted_at TEXT)")
  opened.sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle/0196_rate_book.sql"), "utf8").replaceAll("--> statement-breakpoint", ""))
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: opened.d1 } })
  mocks.getCurrentUser.mockResolvedValue({ id: "staff-a", role, organizationId: "org-a", isActive: true })
  return opened
}

describe("rate book actions", () => {
  it("adds, edits with history, retires and restores", async () => {
    database = open()
    const created = await createRateBookEntry(input)
    expect(created.success).toBe(true)
    const id = created.success ? created.data.id : ""
    expect(await updateRateBookEntry(id, { ...input, unitCostCents: 10250 }, "Diesel up")).toEqual({ success: true, data: null })
    const list = await listRateBookEntries()
    const entry = list.success ? list.data.entries[0] : undefined
    expect(entry?.unitCostCents).toBe(10250)
    expect(entry?.version).toBe(2)
    const history = await getRateBookHistory(id)
    expect(history.success && history.data.map((item) => [item.version, item.snapshot.unitCostCents, item.changeNote])).toEqual([
      [2, 10250, "Diesel up"],
      [1, 9500, "Added"],
    ])
    await setRateBookEntryStatus(id, "retired")
    const picker = await getRateBookPicker("project-a")
    expect(picker.success && picker.data).toEqual([])
    await setRateBookEntryStatus(id, "active")
    const pickerAgain = await getRateBookPicker("project-a")
    expect(pickerAgain.success && pickerAgain.data[0]?.version).toBe(2)
  })

  it("refuses to delete a rate an estimate uses, and deletes an unused one", async () => {
    database = open()
    const created = await createRateBookEntry(input)
    const id = created.success ? created.data.id : ""
    database.sqlite.prepare("INSERT INTO project_estimate_line_cost_items (id, rate_book_entry_id, rate_book_version) VALUES ('ci-1', ?, 1)").run(id)
    const refused = await deleteRateBookEntry(id)
    expect(refused.success).toBe(false)
    database.sqlite.exec("DELETE FROM project_estimate_line_cost_items")
    expect(await deleteRateBookEntry(id)).toEqual({ success: true, data: null })
    const list = await listRateBookEntries()
    expect(list.success && list.data.entries).toEqual([])
  })

  it("lets staff read but only editors change", async () => {
    database = open("field_staff")
    const result = await createRateBookEntry(input)
    expect(result.success).toBe(false)
  })
})
