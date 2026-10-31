import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { projectOperations, projectTodoEvents } from "@/db/schema"
import { changeProjectTodos, deleteProjectTodo } from "@/app/actions/project-todos"
import {
  context,
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "./helpers/correspondence-core"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), cloudflare: vi.fn(), can: vi.fn() }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.auth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.cloudflare }))
vi.mock("@/lib/permission-enforcement", () => ({ canFeature: mocks.can }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
const now = "2026-10-31T12:00:00.000Z"
let testDb: CorrespondenceTestDatabase
function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table)
  testDb.sqlite.exec(
    `CREATE TABLE "${config.name}" (${config.columns.map((c) => `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}`).join(",")})`,
  )
}
function seed(
  id: string,
  status = "open",
  projectId = "project-a",
  recordType = "staff_task",
): void {
  testDb.sqlite
    .prepare(
      "INSERT INTO project_operations (id,project_id,source_record_type,title,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(id, projectId, recordType, id, status, now, now)
}
function status(id: string): unknown {
  return testDb.sqlite.prepare("SELECT status FROM project_operations WHERE id = ?").get(id)
}
const selection = (id: string) => ({ id, updatedAt: now })

beforeEach(() => {
  testDb = openCorrespondenceTestDatabase()
  createTable(projectOperations)
  createTable(projectTodoEvents)
  mocks.auth.mockResolvedValue(context(testDb, "staff-a", "project-a").user)
  mocks.cloudflare.mockResolvedValue({ env: { DB: testDb.d1 } })
  mocks.can.mockResolvedValue(true)
})
afterEach(() => testDb?.close())

describe("guarded bulk to-do actions", () => {
  it("deletes only selected archived to-dos", async () => {
    seed("old", "archived")
    seed("keep", "archived")
    expect(
      await changeProjectTodos("project-a", { mode: "delete", selection: [selection("old")] }),
    ).toEqual({ success: true, data: { changedIds: ["old"], skippedCount: 0 } })
    expect(status("old")).toBeUndefined()
    expect(status("keep")).toEqual({ status: "archived" })
  })
  it("archives and restores a batch without deleting source records", async () => {
    seed("one")
    seed("two")
    const archived = await changeProjectTodos("project-a", {
      mode: "archive",
      selection: [selection("one"), selection("two")],
    })
    expect(archived).toMatchObject({
      success: true,
      data: { changedIds: ["one", "two"], skippedCount: 0 },
    })
    expect(status("one")).toEqual({ status: "archived" })
    const row = await testDb.db.select().from(projectOperations).get()
    if (!row) throw new Error("Archived record missing")
    expect(
      await changeProjectTodos("project-a", {
        mode: "restore",
        selection: [{ id: row.id, updatedAt: row.updatedAt }],
      }),
    ).toMatchObject({ success: true })
    expect(status(row.id)).toEqual({ status: "open" })
  })
  it("refuses active deletion, stale versions, duplicate ids and other projects or record types", async () => {
    seed("active")
    seed("other", "archived", "project-b")
    seed("invoice", "archived", "project-a", "owner_invoice")
    for (const request of [
      { mode: "delete", selection: [selection("active")] },
      { mode: "delete", selection: [selection("other")] },
      { mode: "delete", selection: [selection("invoice")] },
      { mode: "archive", selection: [{ id: "active", updatedAt: "old" }] },
      { mode: "archive", selection: [selection("active"), selection("active")] },
    ] satisfies Parameters<typeof changeProjectTodos>[1][])
      expect((await changeProjectTodos("project-a", request)).success).toBe(false)
    expect(status("active")).toEqual({ status: "open" })
    expect(status("invoice")).toEqual({ status: "archived" })
  })
  it("requires delete permission and project access", async () => {
    seed("archived", "archived")
    mocks.can.mockImplementation(async (_user, _feature, action) => action !== "delete")
    expect(
      (
        await changeProjectTodos("project-a", {
          mode: "delete",
          selection: [selection("archived")],
        })
      ).success,
    ).toBe(false)
    expect((await deleteProjectTodo("project-a", "archived", now)).success).toBe(false)
    mocks.auth.mockResolvedValue(context(testDb, "staff-b", "project-other").user)
    expect(
      (
        await changeProjectTodos("project-a", {
          mode: "archive",
          selection: [selection("archived")],
        })
      ).success,
    ).toBe(false)
    expect(status("archived")).toBeDefined()
  })
  it("keeps a concurrent edit and reports it instead of overwriting it", async () => {
    seed("one")
    seed("two")
    testDb.failures.setBeforeBatchHook((sqlite) => {
      sqlite.exec(
        "UPDATE project_operations SET status='blocked',updated_at='newer' WHERE id='two'",
      )
    })
    const result = await changeProjectTodos("project-a", {
      mode: "archive",
      selection: [selection("one"), selection("two")],
    })
    expect(result).toEqual({ success: true, data: { changedIds: ["one"], skippedCount: 1 } })
    expect(status("two")).toEqual({ status: "blocked" })
  })
  it("rolls back a failing batch and supports D1-sized read chunks", async () => {
    for (let i = 0; i < 110; i++) seed(`item-${i}`)
    testDb.failures.setBindLimit(100)
    testDb.sqlite.exec(
      "CREATE TRIGGER fail_late_update BEFORE UPDATE ON project_operations WHEN OLD.id='item-50' BEGIN SELECT RAISE(ABORT,'late failure'); END",
    )
    const input = {
      mode: "archive",
      selection: Array.from({ length: 110 }, (_, i) => selection(`item-${i}`)),
    } satisfies Parameters<typeof changeProjectTodos>[1]
    expect((await changeProjectTodos("project-a", input)).success).toBe(false)
    expect(status("item-0")).toEqual({ status: "open" })
    testDb.sqlite.exec("DROP TRIGGER fail_late_update")
    expect(await changeProjectTodos("project-a", input)).toMatchObject({
      success: true,
      data: { skippedCount: 0 },
    })
  })
})
