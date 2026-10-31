import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  projectChangeOrderDocuments,
  projectChangeOrderHistory,
  projectChangeOrderLines,
  projectChangeOrders,
  projectMembers,
  projects,
} from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  assertProjectAccess: vi.fn(),
  rebuild: vi.fn(async () => ({ success: true, revisionId: "r", revisionNumber: 1, changed: true })),
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, getCurrentUser: mocks.requireAuth }))
vi.mock("@/lib/permission-enforcement", () => ({
  requireFeaturePermission: vi.fn(async () => undefined),
  canFeature: vi.fn(async () => true),
}))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn(async () => ({ env: { DB: {} } })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/app/actions/google-drive", () => ({ getUploadSessionUrl: vi.fn() }))
vi.mock("@/lib/financials/contract-budget-store", () => ({ rebuildProjectContractBudget: mocks.rebuild }))

import {
  createProjectChangeOrder,
  updateProjectChangeOrder,
  type UpdateProjectChangeOrderInput,
} from "@/app/actions/project-change-orders"

let sqlite: InstanceType<typeof Database>

const TABLES: readonly SQLiteTable[] = [
  projects, projectMembers, projectEstimates, projectChangeOrders, projectChangeOrderLines,
  projectChangeOrderDocuments, projectChangeOrderHistory,
]

function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table)
  const columns = config.columns.map((column) => {
    const value = column.default
    const defaultSql = typeof value === "number" ? ` DEFAULT ${value}` : typeof value === "boolean" ? ` DEFAULT ${Number(value)}` : typeof value === "string" ? ` DEFAULT '${value.replaceAll("'", "''")}'` : ""
    return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`
  })
  sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`)
}

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = new Database(":memory:")
  for (const table of TABLES) createTable(table)
  const db = drizzle(sqlite)
  mocks.getDb.mockReturnValue({
    select: db.select.bind(db), update: db.update.bind(db), insert: db.insert.bind(db), delete: db.delete.bind(db),
    batch: async (queries: readonly { run(): unknown }[]) => sqlite.transaction(() => queries.map((query) => query.run()))(),
  })
  mocks.requireAuth.mockResolvedValue({ id: "staff", role: "admin", displayName: "Estimator", email: "e@example.com" })
  mocks.assertProjectAccess.mockResolvedValue({ projectNumber: "O-166-2750" })
  db.insert(projects).values({ id: "job", name: "Residence", projectNumber: "O-166-2750", createdAt: "t", updatedAt: "t" }).run()
})
afterEach(() => sqlite.close())

function create(kind: string) {
  return createProjectChangeOrder("job", {
    title: "Kitchen window", scope: "Move the window 2 ft east.", reason: null, scheduleImpactDays: null,
    kind, audience: "internal", requesterCompany: null, sourceRecordId: null, sourceHref: null,
    initialStatus: "draft", documents: [], replacementEstimateId: null,
  })
}

function update(id: string, overrides: Partial<UpdateProjectChangeOrderInput>) {
  return updateProjectChangeOrder("job", id, {
    title: "Kitchen window", scope: "Move the window 2 ft east.", reason: null, scheduleImpactDays: null,
    audience: "internal", internalNotes: null, status: "draft", transitionNote: null, documents: [],
    kind: null, replacementEstimateId: null, executedDocument: null, ...overrides,
  })
}

function row(id: string) {
  return sqlite.prepare("SELECT change_order_kind, budget_treatment, amount_cents, status FROM project_change_orders WHERE id = ?").get(id)
}

function lineCount(id: string): unknown {
  return sqlite.prepare("SELECT COUNT(*) AS count FROM project_change_order_lines WHERE change_order_id = ?").get(id)
}

async function created(kind: string): Promise<string> {
  const result = await create(kind)
  if (!result.success) throw new Error(result.error)
  return result.id
}

describe("change-order kinds", () => {
  it("creates a description-only change order at no cost and an estimate one unpriced", async () => {
    expect(row(await created("description"))).toEqual({ change_order_kind: "description", budget_treatment: "additive", amount_cents: 0, status: "draft" })
    expect(row(await created("estimate"))).toEqual({ change_order_kind: "estimate", budget_treatment: "additive", amount_cents: null, status: "draft" })
    expect(await create("cost_lines")).toEqual({ success: false, error: "Choose how the change order is built." })
  })

  it("prices an owner's request with an estimate, whatever kind it sends", async () => {
    mocks.requireAuth.mockResolvedValue({ id: "owner", role: "client", displayName: "Owner", email: "o@example.com" })
    sqlite.prepare("INSERT INTO project_members (id, project_id, user_id, role, assigned_at) VALUES ('m', 'job', 'owner', 'owner', 't')").run()
    const id = await created("description")
    expect(row(id)).toMatchObject({ change_order_kind: "estimate", status: "submitted" })
  })

  it("executes a description-only change order without cost lines", async () => {
    const id = await created("description")
    sqlite.prepare("UPDATE project_change_orders SET status = 'signature_pending' WHERE id = ?").run(id)
    expect((await update(id, { status: "executed" })).success).toBe(true)
    expect(row(id)).toMatchObject({ status: "executed", amount_cents: 0 })
  })

  it("executes an estimate change order only through its accepted estimate", async () => {
    const id = await created("estimate")
    sqlite.prepare("UPDATE project_change_orders SET status = 'signature_pending' WHERE id = ?").run(id)
    expect(await update(id, { status: "executed" })).toEqual({
      success: false,
      error: "Accept this change order's estimate to execute it; its cost lines come from the estimate.",
    })
  })

  it("keeps recorded lines on save and clears them when an older change order is given a kind", async () => {
    sqlite.prepare(`INSERT INTO project_change_orders (id, project_id, change_order_number, title, scope, amount_cents, status, audience, requester_type, requester_name, source_type, budget_treatment, foxit_status, sage_status, created_at, updated_at)
      VALUES ('legacy', 'job', 'O-166-2750-CO-001', 'Plan revisions', 'Lump sum', 4440038, 'draft', 'internal', 'internal', 'Import', 'compass', 'additive', 'not_started', 'not_ready', 't', 't')`).run()
    sqlite.prepare("INSERT INTO project_change_order_lines (id, project_id, change_order_id, line_number, description, cost_code, amount_cents, created_at, updated_at) VALUES ('l1', 'job', 'legacy', 1, 'Plan revisions', '01-100', 4440038, 't', 't')").run()

    expect((await update("legacy", { scope: "Lump sum, reviewed" })).success).toBe(true)
    expect(lineCount("legacy")).toEqual({ count: 1 })
    expect(row("legacy")).toMatchObject({ change_order_kind: null, amount_cents: 4440038 })

    expect((await update("legacy", { kind: "description" })).success).toBe(true)
    expect(lineCount("legacy")).toEqual({ count: 0 })
    expect(row("legacy")).toMatchObject({ change_order_kind: "description", amount_cents: 0 })
  })

  it("won't change how it's built once its estimate is started", async () => {
    const id = await created("estimate")
    sqlite.prepare("INSERT INTO project_estimates (id, project_id, change_order_id, estimate_number, version_number, status, created_at, updated_at) VALUES ('e', 'job', ?, 'O-166-2750-CO-001', 1, 'draft', 't', 't')").run(id)
    expect(await update(id, { kind: "description" })).toEqual({
      success: false,
      error: "This change order already has an estimate; void the estimate before changing how it's built.",
    })
    expect(row(id)).toMatchObject({ change_order_kind: "estimate" })
  })
})
