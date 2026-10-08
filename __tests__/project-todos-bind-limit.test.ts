import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import {
  context,
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "./helpers/correspondence-core"
import {
  projectContacts,
  vendors,
  projectOperations,
  projectPurchaseOrderLines,
  scheduleTasks,
} from "@/db/schema"
import {
  getProjectPurchaseOrders,
  getProjectTodos,
} from "@/app/actions/project-operations"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cloudflare: vi.fn(),
  permission: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.cloudflare }))
vi.mock("@/lib/permission-enforcement", () => ({
  requireFeaturePermission: mocks.permission,
  canFeature: vi.fn().mockResolvedValue(true),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("server-only", () => ({}))

const date = "2026-10-07T12:00:00.000Z"
// More linked records than D1 accepts as bound parameters in one query.
const LINKED_TODOS = 150
let testDb: CorrespondenceTestDatabase

function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table)
  testDb.sqlite.exec(
    `CREATE TABLE "${config.name}" (${config.columns
      .map((c) => `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}`)
      .join(",")})`
  )
}

beforeEach(() => {
  testDb = openCorrespondenceTestDatabase()
  // The shared harness creates a reduced contacts table; use the full schema here.
  testDb.sqlite.exec("DROP TABLE project_contacts")
  for (const table of [projectContacts, vendors, projectOperations, projectPurchaseOrderLines, scheduleTasks]) {
    createTable(table)
  }
  const insertTask = testDb.sqlite.prepare(
    "INSERT INTO schedule_tasks (id, project_id, title) VALUES (?, 'project-a', ?)"
  )
  const insertTodo = testDb.sqlite.prepare(
    "INSERT INTO project_operations (id, project_id, source_record_type, source_record_id, title, status, created_at, updated_at) VALUES (?, 'project-a', 'schedule_task', ?, ?, 'open', ?, ?)"
  )
  for (let index = 0; index < LINKED_TODOS; index += 1) {
    insertTask.run(`task-${index}`, `Task ${index}`)
    insertTodo.run(`todo-${index}`, `task-${index}`, `To-do ${index}`, date, date)
  }
  mocks.cloudflare.mockResolvedValue({ env: { DB: testDb.d1 } })
  mocks.permission.mockResolvedValue(undefined)
  mocks.auth.mockResolvedValue(context(testDb, "staff-a", "project-a").user)
  testDb.failures.setBindLimit(100)
})

afterEach(() => testDb.close())

describe("project to-dos on large jobs", () => {
  it("loads more linked to-dos than D1 binds in one query", async () => {
    const items = await getProjectTodos("project-a")
    expect(items).toHaveLength(LINKED_TODOS)
  })

  it("loads purchase order lines in chunks", async () => {
    const insertPurchaseOrder = testDb.sqlite.prepare(
      "INSERT INTO project_operations (id, project_id, source_record_type, title, status, created_at, updated_at) VALUES (?, 'project-a', 'purchase_order', ?, 'open', ?, ?)"
    )
    for (let index = 0; index < LINKED_TODOS; index += 1) {
      insertPurchaseOrder.run(`po-${index}`, `PO ${index}`, date, date)
    }
    const orders = await getProjectPurchaseOrders("project-a")
    expect(orders).toHaveLength(LINKED_TODOS)
  })
})
