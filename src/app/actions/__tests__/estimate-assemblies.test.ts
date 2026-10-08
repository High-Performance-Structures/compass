import { readFileSync } from "node:fs"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig } from "drizzle-orm/sqlite-core"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { projectEstimateLines, projectEstimates } from "@/db/schema-estimates"
import { estimateAssemblyRevisionStatements } from "@/lib/estimates/assembly-revision"

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), requireAuth: vi.fn(), requirePermission: vi.fn(), assertProjectAccess: vi.fn(), recordActivityEvent: vi.fn() }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn(async () => ({ env: { DB: {} } })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { saveProjectEstimateAssembly, deleteProjectEstimateAssembly } from "@/app/actions/estimate-assemblies"

let sqlite: InstanceType<typeof Database>

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  sqlite.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, organization_id TEXT, address TEXT, mailing_address TEXT, client_name TEXT)")
  // Build the pre-assembly column layout, then apply the real additive migration.
  for (const table of [projectEstimates, projectEstimateLines]) {
    const config = getTableConfig(table)
    const columns = config.columns.filter((column) => column.name !== "assembly_id").map((column) => {
      const value = column.default
      const defaultSql = typeof value === "number" ? ` DEFAULT ${value}` : typeof value === "boolean" ? ` DEFAULT ${Number(value)}` : typeof value === "string" ? ` DEFAULT '${value.replaceAll("'", "''")}'` : ""
      return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`
    })
    sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`)
  }
  sqlite.exec(readFileSync("drizzle/0177_estimate_assemblies.sql", "utf8"))
  sqlite.exec("INSERT INTO projects (id, name, organization_id) VALUES ('project', 'Example', 'org')")
  const db = drizzle(sqlite)
  db.insert(projectEstimates).values([
    { id: "estimate", projectId: "project", estimateNumber: "E1", createdAt: "now", updatedAt: "now" },
    { id: "foreign", projectId: "project", estimateNumber: "E2", createdAt: "now", updatedAt: "now" },
  ]).run()
  db.insert(projectEstimateLines).values([
    { id: "earth", projectId: "project", estimateId: "estimate", divisionCode: "31", divisionName: "Earthwork", costCode: "31-100", costCodeName: "Excavation", description: "Excavation", lineTotalCents: 1200000, sortOrder: 0, createdAt: "now", updatedAt: "now" },
    { id: "concrete", projectId: "project", estimateId: "estimate", divisionCode: "03", divisionName: "Concrete", costCode: "03-100", costCodeName: "Footings", description: "Footings", lineTotalCents: 1800000, sortOrder: 1, createdAt: "now", updatedAt: "now" },
    { id: "foreign-line", projectId: "project", estimateId: "foreign", divisionCode: "03", divisionName: "Concrete", costCode: "03-100", costCodeName: "Footings", description: "Foreign", lineTotalCents: 999, createdAt: "now", updatedAt: "now" },
  ]).run()
  mocks.getDb.mockReturnValue({
    select: db.select.bind(db), update: db.update.bind(db), insert: db.insert.bind(db), delete: db.delete.bind(db),
    batch: async (queries: readonly { run(): unknown }[]) => sqlite.transaction(() => queries.map((query) => query.run()))(),
  })
  mocks.requireAuth.mockResolvedValue({ id: "user", role: "project_manager" })
  mocks.assertProjectAccess.mockResolvedValue({ projectNumber: "H-100" })
})
afterEach(() => sqlite.close())

async function createAssembly(name = "Foundation", lineIds = ["earth", "concrete"]): Promise<string> {
  const result = await saveProjectEstimateAssembly("project", "estimate", null, { name, description: "Complete scope", lineIds })
  if (!result.success) throw new Error(result.error)
  return result.id
}

describe("assembly server actions and persistence", () => {
  it("creates, renames and edits a cross-division assembly without changing prices", async () => {
    const id = await createAssembly()
    expect(sqlite.prepare("SELECT assembly_id FROM project_estimate_lines WHERE estimate_id = 'estimate'").all()).toEqual([{ assembly_id: id }, { assembly_id: id }])
    const updated = await saveProjectEstimateAssembly("project", "estimate", id, { name: "Foundation package", description: "", lineIds: ["concrete"] })
    expect(updated.success).toBe(true)
    expect(sqlite.prepare("SELECT name FROM project_estimate_assemblies").get()).toEqual({ name: "Foundation package" })
    expect(sqlite.prepare("SELECT assembly_id, line_total_cents FROM project_estimate_lines WHERE id = 'earth'").get()).toEqual({ assembly_id: null, line_total_cents: 1200000 })
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "budget", "update")
  })

  it("moves membership instead of duplicating items and retains items on deletion", async () => {
    const firstId = await createAssembly()
    const secondId = await createAssembly("Earthwork", ["earth"])
    expect(sqlite.prepare("SELECT assembly_id FROM project_estimate_lines WHERE id = 'earth'").get()).toEqual({ assembly_id: secondId })
    expect((await deleteProjectEstimateAssembly("project", "estimate", secondId)).success).toBe(true)
    expect(sqlite.prepare("SELECT COUNT(*) AS count, SUM(line_total_cents) AS total FROM project_estimate_lines WHERE estimate_id = 'estimate'").get()).toEqual({ count: 2, total: 3000000 })
    expect(sqlite.prepare("SELECT assembly_id FROM project_estimate_lines WHERE id = 'concrete'").get()).toEqual({ assembly_id: firstId })
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "estimate_assembly_deleted" }))
  })

  it("rejects foreign items and foreign assemblies before changing data", async () => {
    const id = await createAssembly()
    expect((await saveProjectEstimateAssembly("project", "estimate", id, { name: "Invalid", description: "", lineIds: ["foreign-line"] })).success).toBe(false)
    expect((await saveProjectEstimateAssembly("project", "foreign", id, { name: "Invalid", description: "", lineIds: [] })).success).toBe(false)
    expect((await deleteProjectEstimateAssembly("project", "foreign", id)).success).toBe(false)
    expect(sqlite.prepare("SELECT name FROM project_estimate_assemblies").get()).toEqual({ name: "Foundation" })
  })

  it("rejects locked estimates, external users and inaccessible projects", async () => {
    sqlite.exec("UPDATE project_estimates SET status = 'accepted' WHERE id = 'estimate'")
    expect((await saveProjectEstimateAssembly("project", "estimate", null, { name: "No", description: "", lineIds: [] })).success).toBe(false)
    sqlite.exec("UPDATE project_estimates SET status = 'draft' WHERE id = 'estimate'")
    mocks.requireAuth.mockResolvedValue({ id: "owner", role: "owner" })
    expect((await saveProjectEstimateAssembly("project", "estimate", null, { name: "No", description: "", lineIds: [] })).success).toBe(false)
    mocks.requireAuth.mockResolvedValue({ id: "user", role: "project_manager" })
    mocks.assertProjectAccess.mockRejectedValue(new Error("Access denied"))
    expect((await saveProjectEstimateAssembly("project", "estimate", null, { name: "No", description: "", lineIds: [] })).success).toBe(false)
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_estimate_assemblies").get()).toEqual({ count: 0 })
  })

  it("copies assemblies and remaps line assignments for a revision", async () => {
    const id = await createAssembly()
    // Leave one item outside an assembly to prove that revisions copy it too.
    sqlite.exec("UPDATE project_estimate_lines SET assembly_id = NULL WHERE id = 'earth'")
    sqlite.exec(`INSERT INTO project_estimate_lines (id, project_id, estimate_id, assembly_id, division_code, division_name, cost_code, cost_code_name, description, line_total_cents, created_at, updated_at)
      SELECT id || '-copy', project_id, 'foreign', assembly_id, division_code, division_name, cost_code, cost_code_name, description, line_total_cents, created_at, updated_at FROM project_estimate_lines WHERE estimate_id = 'estimate'`)
    const queries: { readonly sql: string; readonly values: readonly unknown[] }[] = []
    const db = vi.fn().mockReturnValue({ prepare: (sql: string) => ({ bind: (...values: unknown[]) => { const query = { sql, values }; queries.push(query); return query } }) })()
    estimateAssemblyRevisionStatements({ db, projectId: "project", estimateId: "foreign", now: "later", assemblies: [{ id, name: "Foundation", description: "Complete scope", sortOrder: 0 }] })
    sqlite.transaction(() => { for (const query of queries) sqlite.prepare(query.sql).run(...query.values) })()
    const copy = sqlite.prepare("SELECT id, name FROM project_estimate_assemblies WHERE estimate_id = 'foreign'").get()
    expect(copy).toEqual({ id: expect.any(String), name: "Foundation" })
    expect(copy).not.toEqual({ id, name: "Foundation" })
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_estimate_lines WHERE estimate_id = 'foreign' AND description != 'Foreign'").get()).toEqual({ count: 2 })
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_estimate_lines l JOIN project_estimate_assemblies a ON a.id = l.assembly_id WHERE l.estimate_id = 'foreign' AND a.estimate_id = 'foreign'").get()).toEqual({ count: 1 })
  })
})
