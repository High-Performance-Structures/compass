import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { projectEstimateAssemblies, projectEstimateLines, projectEstimates } from "@/db/schema-estimates"

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), requireAuth: vi.fn(), requirePermission: vi.fn(), assertProjectAccess: vi.fn(), recordActivityEvent: vi.fn(), context: vi.fn(), revalidate: vi.fn() }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.context }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
import { reorderProjectEstimateLines } from "@/app/actions/estimate-line-order"

let sqlite: InstanceType<typeof Database>
let beforeBatch: () => void
let parameterCounts: number[]
type Statement = { readonly sql: string; readonly values: readonly (string | number)[] }
const initial = "2026-10-01T00:00:00.000Z"
const division = { type: "division", divisionCode: "03" } as const

function snapshot(): unknown[] {
  return sqlite.prepare("SELECT id, division_code, cost_code, assembly_id, report_phase_id, direct_cost_cents, line_total_cents, sort_order FROM project_estimate_lines ORDER BY id").all()
}
function input(previousIds = ["a", "c"], orderedIds = ["c", "a"]) {
  return { group: division, previousIds, orderedIds, expectedUpdatedAt: initial }
}
beforeEach(() => {
  vi.clearAllMocks()
  beforeBatch = () => undefined
  parameterCounts = []
  sqlite = new Database(":memory:")
  sqlite.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, organization_id TEXT, address TEXT, mailing_address TEXT, client_name TEXT)")
  for (const table of [projectEstimates, projectEstimateLines, projectEstimateAssemblies]) {
    const config = getTableConfig(table)
    const columns = config.columns.map((column) => {
      const value = column.default
      const defaultSql = typeof value === "number" ? ` DEFAULT ${value}` : typeof value === "boolean" ? ` DEFAULT ${Number(value)}` : typeof value === "string" ? ` DEFAULT '${value.replaceAll("'", "''")}'` : ""
      return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`
    })
    sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`)
  }
  sqlite.exec("INSERT INTO projects (id, name, organization_id) VALUES ('project', 'Example', 'org')")
  const db = drizzle(sqlite)
  db.insert(projectEstimates).values([
    { id: "estimate", projectId: "project", estimateNumber: "E1", directCostCents: 300, estimateTotalCents: 300, foxitStatus: "prepared", foxitPreparedSourceHash: "prior", createdAt: initial, updatedAt: initial },
    { id: "foreign", projectId: "project", estimateNumber: "E2", createdAt: initial, updatedAt: initial },
  ]).run()
  db.insert(projectEstimateAssemblies).values({ id: "phase", estimateId: "estimate", name: "Foundation", createdAt: initial, updatedAt: initial }).run()
  db.insert(projectEstimateLines).values([
    { id: "a", projectId: "project", estimateId: "estimate", assemblyId: "phase", divisionCode: "03", divisionName: "Concrete", costCode: "03-10", costCodeName: "Walls", description: "Walls", directCostCents: 100, lineTotalCents: 100, sortOrder: 0, createdAt: initial, updatedAt: initial },
    { id: "b", projectId: "project", estimateId: "estimate", assemblyId: "phase", divisionCode: "31", divisionName: "Earthwork", costCode: "31-1", costCodeName: "Earthwork", description: "Earthwork", directCostCents: 100, lineTotalCents: 100, sortOrder: 1, createdAt: initial, updatedAt: initial },
    { id: "c", projectId: "project", estimateId: "estimate", divisionCode: "03", divisionName: "Concrete", costCode: "03-2", costCodeName: "Footings", description: "Footings", directCostCents: 100, lineTotalCents: 100, sortOrder: 2, createdAt: initial, updatedAt: initial },
    { id: "foreign-line", projectId: "project", estimateId: "foreign", divisionCode: "03", divisionName: "Concrete", costCode: "03-1", costCodeName: "Foreign", description: "Foreign", sortOrder: 0, createdAt: initial, updatedAt: initial },
  ]).run()
  mocks.getDb.mockReturnValue(db)
  const raw = {
    prepare: (sql: string) => ({ bind: (...values: readonly (string | number)[]): Statement => { parameterCounts.push(values.length); return { sql, values } } }),
    batch: async (statements: readonly Statement[]) => {
      beforeBatch()
      return sqlite.transaction(() => statements.map((statement) => ({ meta: { changes: sqlite.prepare(statement.sql).run(...statement.values).changes } })))()
    },
  }
  mocks.context.mockResolvedValue({ env: { DB: raw } })
  mocks.requireAuth.mockResolvedValue({ id: "staff", role: "project_manager" })
  mocks.assertProjectAccess.mockResolvedValue({ projectNumber: "H-100" })
})
afterEach(() => sqlite.close())

describe("estimate item ordering", () => {
  it("atomically moves division items without changing other groups, classifications or amounts", async () => {
    const before = snapshot()
    expect((await reorderProjectEstimateLines("project", "estimate", input())).success).toBe(true)
    expect(snapshot()).toEqual([
      expect.objectContaining({ id: "a", sort_order: 2, assembly_id: "phase", line_total_cents: 100 }),
      before[1], expect.objectContaining({ id: "c", sort_order: 0, assembly_id: null, line_total_cents: 100 }), before[3],
    ])
    expect(sqlite.prepare("SELECT direct_cost_cents, estimate_total_cents, foxit_status, foxit_prepared_source_hash FROM project_estimates WHERE id = 'estimate'").get())
      .toEqual({ direct_cost_cents: 300, estimate_total_cents: 300, foxit_status: "not_started", foxit_prepared_source_hash: null })
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "estimate_items_reordered" }))
    expect(mocks.revalidate).toHaveBeenCalledWith("/print/projects/project/estimate")
  })
  it("reorders a cross-division assembly and Other work", async () => {
    expect((await reorderProjectEstimateLines("project", "estimate", { ...input(["a", "b"], ["b", "a"]), group: { type: "assembly", assemblyId: "phase" } })).success).toBe(true)
    expect(sqlite.prepare("SELECT id FROM project_estimate_lines WHERE estimate_id = 'estimate' ORDER BY sort_order").all()).toEqual([{ id: "b" }, { id: "a" }, { id: "c" }])
    sqlite.exec(`UPDATE project_estimates SET updated_at = '${initial}' WHERE id = 'estimate'`)
    expect((await reorderProjectEstimateLines("project", "estimate", { ...input(["c"], ["c"]), group: { type: "assembly", assemblyId: null } })).success).toBe(true)
  })
  it("rejects foreign, duplicate, omitted, mixed-group and stale items before changing the order", async () => {
    const before = snapshot()
    for (const request of [input(["a", "c"], ["a", "foreign-line"]), input(["a", "c"], ["a", "a"]), input(["a", "c"], ["a"]), input(["a", "c"], ["a", "b"]), input(["c", "a"], ["a", "c"]), { ...input(), expectedUpdatedAt: "stale" }, { ...input(), group: { type: "assembly", assemblyId: "foreign" } as const }]) {
      expect((await reorderProjectEstimateLines("project", "estimate", request)).success).toBe(false)
      expect(snapshot()).toEqual(before)
    }
  })
  it("rejects locked estimates, external users and inaccessible projects", async () => {
    const before = snapshot()
    for (const status of ["accepted", "signature_pending", "superseded", "void"]) {
      sqlite.prepare("UPDATE project_estimates SET status = ? WHERE id = 'estimate'").run(status)
      expect((await reorderProjectEstimateLines("project", "estimate", input())).success).toBe(false)
    }
    sqlite.exec("UPDATE project_estimates SET status = 'draft' WHERE id = 'estimate'")
    mocks.requireAuth.mockResolvedValue({ id: "owner", role: "owner" })
    expect((await reorderProjectEstimateLines("project", "estimate", input())).success).toBe(false)
    mocks.requireAuth.mockResolvedValue({ id: "staff", role: "project_manager" })
    mocks.assertProjectAccess.mockRejectedValue(new Error("Access denied"))
    expect((await reorderProjectEstimateLines("project", "estimate", input())).success).toBe(false)
    expect(snapshot()).toEqual(before)
  })
  it("guards against a change or signature lock between validation and the atomic batch", async () => {
    const before = snapshot()
    beforeBatch = () => sqlite.exec("UPDATE project_estimates SET updated_at = 'later' WHERE id = 'estimate'")
    expect((await reorderProjectEstimateLines("project", "estimate", input())).success).toBe(false)
    expect(snapshot()).toEqual(before)
    sqlite.exec(`UPDATE project_estimates SET updated_at = '${initial}' WHERE id = 'estimate'`)
    beforeBatch = () => sqlite.exec("UPDATE project_estimates SET status = 'signature_pending' WHERE id = 'estimate'")
    expect((await reorderProjectEstimateLines("project", "estimate", input())).success).toBe(false)
    expect(snapshot()).toEqual(before)
  })
  it("chunks a large group below D1 parameter limits", async () => {
    const insert = sqlite.prepare("INSERT INTO project_estimate_lines (id, project_id, estimate_id, division_code, division_name, cost_code, cost_code_name, description, sort_order, created_at, updated_at) VALUES (?, 'project', 'estimate', '03', 'Concrete', ?, 'Concrete', 'Concrete', ?, ?, ?)")
    for (let i = 0; i < 201; i++) insert.run(`large-${i}`, `03-${i}`, i + 3, initial, initial)
    const previousIds = ["a", "c", ...Array.from({ length: 201 }, (_, i) => `large-${i}`)]
    expect((await reorderProjectEstimateLines("project", "estimate", input(previousIds, [...previousIds].reverse()))).success).toBe(true)
    expect(parameterCounts.length).toBeGreaterThan(2)
    expect(Math.max(...parameterCounts)).toBeLessThan(100)
    expect(sqlite.prepare("SELECT id FROM project_estimate_lines WHERE estimate_id = 'estimate' AND division_code = '03' ORDER BY sort_order").all()).toEqual([...previousIds].reverse().map((id) => ({ id })))
  })
})
