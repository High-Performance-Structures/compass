import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { projects } from "@/db/schema"
import {
  projectEstimateAssemblies,
  projectEstimateAssemblyCopies,
  projectEstimateLineCostItems,
  projectEstimateLines,
  projectEstimateReportPhases,
  projectEstimates,
} from "@/db/schema-estimates"
import { projectLinks } from "@/db/schema-project-links"

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  assertProjectAccess: vi.fn(),
  recordActivityEvent: vi.fn(),
  readFeatureSettings: vi.fn(),
  createProjectEstimateDraft: vi.fn(),
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/permissions", () => ({ requirePermission: vi.fn() }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent, activityActorName: () => "Estimator" }))
vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: mocks.readFeatureSettings }))
vi.mock("@/app/actions/project-estimates", () => ({ createProjectEstimateDraft: mocks.createProjectEstimateDraft }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn(async () => ({ env: { DB: null } })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  copyEstimateAssembliesToProject,
  getEstimateAssemblyCopies,
  getEstimateCopyTarget,
} from "@/app/actions/estimate-project-copies"
import { UNASSIGNED_ITEMS } from "@/lib/estimates/assembly-copy"

let sqlite: InstanceType<typeof Database>

const TABLES: readonly SQLiteTable[] = [
  projects, projectEstimates, projectEstimateLines, projectEstimateAssemblies, projectEstimateLineCostItems,
  projectEstimateReportPhases, projectEstimateAssemblyCopies, projectLinks,
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

function line(id: string, assemblyId: string | null, costCode: string, quantity: number, unitCostCents: number, markup: number, sortOrder: number) {
  const direct = quantity * unitCostCents
  const markupCents = (direct * markup) / 10_000
  return {
    id, projectId: "squires-o", estimateId: "o-est", assemblyId, divisionCode: costCode.slice(0, 2), divisionName: "Division",
    costCode, costCodeName: costCode, description: costCode, quantity, unit: "SF", unitCostCents, directCostCents: direct,
    markupRateBasisPoints: markup, markupCents, lineTotalCents: direct + markupCents, includeInBuilderFee: true,
    reportPhaseId: costCode === "03-100" ? "o-phase" : null, sortOrder, createdAt: "t", updatedAt: "t",
  }
}

function seed(): void {
  const db = drizzle(sqlite)
  db.insert(projects).values([
    { id: "squires-o", name: "Squires Residence", projectNumber: "O-184-5250", organizationId: "org", jobStatusId: "estimating", createdAt: "t", updatedAt: "t" },
    { id: "squires-h", name: "Squires Residence", projectNumber: "H-441-5250", organizationId: "org", jobStatusId: "estimating", createdAt: "t", updatedAt: "t" },
  ]).run()
  db.insert(projectEstimates).values({
    id: "o-est", projectId: "squires-o", estimateNumber: "O-184-5250-03", versionNumber: 1, status: "draft",
    marginRateBasisPoints: 1000, createdAt: "t", updatedAt: "t",
  }).run()
  db.insert(projectEstimateAssemblies).values([
    { id: "foundation", estimateId: "o-est", name: "Foundation", sortOrder: 0, createdAt: "t", updatedAt: "t" },
    { id: "framing", estimateId: "o-est", name: "Framing", sortOrder: 1, createdAt: "t", updatedAt: "t" },
  ]).run()
  db.insert(projectEstimateReportPhases).values({
    id: "o-phase", projectId: "squires-o", estimateId: "o-est", divisionCode: "03", name: "Concrete", sortOrder: 1, createdAt: "t", updatedAt: "t",
  }).run()
  db.insert(projectEstimateLines).values([
    line("f1", "foundation", "03-100", 100, 10_00, 2000, 0),
    line("f2", "foundation", "03-200", 1, 0, 2000, 1),
    line("w1", "framing", "06-100", 10, 50_00, 2000, 2),
    line("u1", null, "01-500", 1, 500_00, 0, 3),
  ]).run()
  // f2 has a cost breakdown: two items at 20% markup.
  db.insert(projectEstimateLineCostItems).values([
    { id: "c1", projectId: "squires-o", estimateId: "o-est", estimateLineId: "f2", divisionCode: "03", divisionName: "Division", costCode: "03-200", costCodeName: "x", description: "Rebar", quantity: 2, unit: "T", unitCostCents: 1000_00, directCostCents: 2000_00, markupRateBasisPoints: 2000, sortOrder: 0, createdAt: "t", updatedAt: "t" },
    { id: "c2", projectId: "squires-o", estimateId: "o-est", estimateLineId: "f2", divisionCode: "03", divisionName: "Division", costCode: "03-200", costCodeName: "x", description: "Old", quantity: 1, unit: "T", unitCostCents: 999_00, directCostCents: 999_00, markupRateBasisPoints: 2000, sortOrder: 1, deletedAt: "t", createdAt: "t", updatedAt: "t" },
  ]).run()
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
  mocks.requireAuth.mockResolvedValue({ id: "user", role: "admin" })
  mocks.assertProjectAccess.mockImplementation(async (_db: unknown, _user: unknown, projectId: string) => ({
    projectNumber: projectId === "squires-h" ? "H-441-5250" : "O-184-5250",
  }))
  mocks.readFeatureSettings.mockResolvedValue({ modes: {}, copyMarkupPercents: { H: 15 } })
  mocks.createProjectEstimateDraft.mockImplementation(async (projectId: string) => {
    drizzle(sqlite).insert(projectEstimates).values({
      id: "h-est", projectId, estimateNumber: "H-441-5250-00", versionNumber: 1, status: "draft", createdAt: "t", updatedAt: "t",
    }).run()
    return { success: true, id: "h-est" }
  })
  seed()
})
afterEach(() => sqlite.close())

describe("copying estimate assemblies to another job", () => {
  it("offers a new draft and the department's copy markup", async () => {
    const target = await getEstimateCopyTarget("squires-h")
    expect(target).toMatchObject({ projectNumber: "H-441-5250", markupPercent: 15, drafts: [], newDraftBlocked: null })
  })

  it("copies an assembly into a new draft at the target markup and leaves the source alone", async () => {
    const result = await copyEstimateAssembliesToProject({
      sourceProjectId: "squires-o", sourceEstimateId: "o-est", assemblyIds: ["foundation"],
      targetProjectId: "squires-h", targetEstimateId: null, markupPercent: 15,
    })
    expect(result).toMatchObject({ success: true, estimateId: "h-est", estimateNumber: "H-441-5250-00" })
    const lines = sqlite.prepare("SELECT cost_code, quantity, unit, unit_cost_cents, markup_rate_basis_points, markup_cents, line_total_cents, include_in_builder_fee FROM project_estimate_lines WHERE estimate_id = 'h-est' ORDER BY sort_order").all()
    expect(lines).toEqual([
      { cost_code: "03-100", quantity: 100, unit: "SF", unit_cost_cents: 10_00, markup_rate_basis_points: 1500, markup_cents: 150_00, line_total_cents: 1150_00, include_in_builder_fee: 1 },
      // Rolled up from its one live cost item (the deleted one is not copied).
      { cost_code: "03-200", quantity: 1, unit: "assembly", unit_cost_cents: 2000_00, markup_rate_basis_points: 1500, markup_cents: 300_00, line_total_cents: 2300_00, include_in_builder_fee: 1 },
    ])
    expect(sqlite.prepare("SELECT description, markup_rate_basis_points, line_total_cents FROM project_estimate_line_cost_items WHERE estimate_id = 'h-est'").all())
      .toEqual([{ description: "Rebar", markup_rate_basis_points: 1500, line_total_cents: 2300_00 }])
    expect(sqlite.prepare("SELECT name FROM project_estimate_assemblies WHERE estimate_id = 'h-est'").all()).toEqual([{ name: "Foundation" }])
    expect(sqlite.prepare("SELECT name FROM project_estimate_report_phases WHERE estimate_id = 'h-est'").all()).toEqual([{ name: "Concrete" }])
    // The target has no builder fee rates of its own, so the total is just the lines.
    expect(sqlite.prepare("SELECT estimate_total_cents FROM project_estimates WHERE id = 'h-est'").get()).toEqual({ estimate_total_cents: 3450_00 })
    // Source untouched.
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_estimate_lines WHERE estimate_id = 'o-est'").get()).toEqual({ count: 4 })
    expect(sqlite.prepare("SELECT markup_rate_basis_points FROM project_estimate_lines WHERE id = 'f1'").get()).toEqual({ markup_rate_basis_points: 2000 })
    // Linked, and noted on the source.
    expect(sqlite.prepare("SELECT project_id, linked_project_id FROM project_links").all()).toEqual([{ project_id: "squires-o", linked_project_id: "squires-h" }])
    const copies = await getEstimateAssemblyCopies("squires-o", "o-est")
    expect(copies).toMatchObject([{ sourceAssemblyId: "foundation", assemblyName: "Foundation", targetEstimateNumber: "H-441-5250-00" }])
  })

  it("adds to an existing draft after its lines, keeps source markup when asked, and doesn't link twice", async () => {
    await copyEstimateAssembliesToProject({
      sourceProjectId: "squires-o", sourceEstimateId: "o-est", assemblyIds: ["foundation"],
      targetProjectId: "squires-h", targetEstimateId: null, markupPercent: 15,
    })
    // A new contract draft is no longer offered on this one-estimate job.
    const target = await getEstimateCopyTarget("squires-h")
    expect(target).toMatchObject({ drafts: [{ id: "h-est" }], newDraftBlocked: expect.any(String) })
    const blocked = await copyEstimateAssembliesToProject({
      sourceProjectId: "squires-o", sourceEstimateId: "o-est", assemblyIds: ["framing"],
      targetProjectId: "squires-h", targetEstimateId: null, markupPercent: null,
    })
    expect(blocked.success).toBe(false)
    const result = await copyEstimateAssembliesToProject({
      sourceProjectId: "squires-o", sourceEstimateId: "o-est", assemblyIds: ["framing", UNASSIGNED_ITEMS],
      targetProjectId: "squires-h", targetEstimateId: "h-est", markupPercent: null,
    })
    expect(result.success).toBe(true)
    const lines = sqlite.prepare("SELECT cost_code, assembly_id IS NULL AS loose, markup_rate_basis_points FROM project_estimate_lines WHERE estimate_id = 'h-est' ORDER BY sort_order").all()
    expect(lines).toEqual([
      { cost_code: "03-100", loose: 0, markup_rate_basis_points: 1500 },
      { cost_code: "03-200", loose: 0, markup_rate_basis_points: 1500 },
      { cost_code: "06-100", loose: 0, markup_rate_basis_points: 2000 },
      { cost_code: "01-500", loose: 1, markup_rate_basis_points: 0 },
    ])
    expect(sqlite.prepare("SELECT name, sort_order FROM project_estimate_assemblies WHERE estimate_id = 'h-est' ORDER BY sort_order").all())
      .toEqual([{ name: "Foundation", sort_order: 1 }, { name: "Framing", sort_order: 2 }])
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_links").get()).toEqual({ count: 1 })
    expect((await getEstimateAssemblyCopies("squires-o", "o-est")).map((copy) => copy.assemblyName).sort())
      .toEqual(["Foundation", "Framing", "Items not in an assembly"])
  })

  it("refuses a locked target estimate and copying into the same job", async () => {
    drizzle(sqlite).insert(projectEstimates).values({
      id: "h-signed", projectId: "squires-h", estimateNumber: "H-441-5250-00", versionNumber: 1, status: "accepted", createdAt: "t", updatedAt: "t",
    }).run()
    const locked = await copyEstimateAssembliesToProject({
      sourceProjectId: "squires-o", sourceEstimateId: "o-est", assemblyIds: ["foundation"],
      targetProjectId: "squires-h", targetEstimateId: "h-signed", markupPercent: null,
    })
    expect(locked.success).toBe(false)
    const same = await copyEstimateAssembliesToProject({
      sourceProjectId: "squires-o", sourceEstimateId: "o-est", assemblyIds: ["foundation"],
      targetProjectId: "squires-o", targetEstimateId: null, markupPercent: null,
    })
    expect(same).toEqual({ success: false, error: "Choose a different job to copy into." })
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_estimate_lines WHERE estimate_id <> 'o-est'").get()).toEqual({ count: 0 })
  })
})
