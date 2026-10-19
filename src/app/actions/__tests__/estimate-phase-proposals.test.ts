import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  projectChangeOrderHistory,
  projectChangeOrderLines,
  projectChangeOrders,
  projects,
  sageCostCodes,
} from "@/db/schema"
import { contractPackets } from "@/db/schema-contracts"
import {
  projectEstimateAcknowledgements,
  projectEstimateAssemblies,
  projectEstimateBasisDocuments,
  projectEstimateLineCostItems,
  projectEstimateLines,
  projectEstimatePhaseDescriptions,
  projectEstimateReportPhases,
  projectEstimates,
  projectPhaseProposals,
} from "@/db/schema-estimates"
import { projectFamilies, projectFamilyPhases } from "@/db/schema-project-families"
import { projectEstimateRfqBidImportLines, projectEstimateRfqBidImports } from "@/db/schema-rfqs"

const mocks = vi.hoisted(() => {
  const rawDb: { current: unknown } = { current: null }
  return {
    getDb: vi.fn(),
    rawDb,
    requireAuth: vi.fn(),
    requirePermission: vi.fn(),
    assertProjectAccess: vi.fn(),
    recordActivityEvent: vi.fn(),
  }
})
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/activity-log", () => ({
  recordActivityEvent: mocks.recordActivityEvent,
  activityActorName: () => "Estimator",
}))
vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn(async () => ({ env: { DB: mocks.rawDb.current } })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  deletePhaseProposal,
  exportEstimateAssemblyAsPhase,
  finishPhaseProposal,
  getProjectPhaseProposals,
} from "@/app/actions/estimate-phase-proposals"

let sqlite: InstanceType<typeof Database>

const TABLES: readonly SQLiteTable[] = [
  projects, projectEstimates, projectEstimateLines, projectEstimateAssemblies, projectEstimateLineCostItems,
  projectEstimateReportPhases, projectEstimatePhaseDescriptions, projectEstimateAcknowledgements,
  projectEstimateBasisDocuments, projectPhaseProposals, projectFamilies, projectFamilyPhases,
  projectChangeOrders, projectChangeOrderLines, projectChangeOrderHistory, sageCostCodes, contractPackets,
  projectEstimateRfqBidImports, projectEstimateRfqBidImportLines,
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

/** Enough of D1's prepared-statement API for the export's raw SQL. */
function d1Adapter(): unknown {
  const prepare = (sql: string) => {
    const params: readonly unknown[] = []
    const statement = { sql, params, bind: (...bound: unknown[]) => ({ ...statement, params: bound }) }
    return statement
  }
  return {
    prepare,
    batch: async (statements: readonly { readonly sql: string; readonly params: readonly unknown[] }[]) =>
      sqlite.transaction(() => statements.map((statement) => {
        sqlite.prepare(statement.sql).run(...statement.params.map((param) => typeof param === "boolean" ? Number(param) : param))
        return { success: true }
      }))(),
  }
}

function line(id: string, estimateId: string, assemblyId: string | null, costCode: string, cents: number, sortOrder: number) {
  return {
    id, projectId: "squires", estimateId, assemblyId, divisionCode: costCode.slice(0, 2), divisionName: "Division",
    costCode, costCodeName: costCode, description: costCode, directCostCents: cents, lineTotalCents: cents,
    includeInBuilderFee: true, sortOrder, createdAt: "t", updatedAt: "t",
  }
}

function seed(contractStatus: string): void {
  const db = drizzle(sqlite)
  db.insert(projects).values({
    id: "squires", name: "Ridge Rd - Squires Residence", projectNumber: "O-184-5250", organizationId: "org",
    clientName: "Client", address: "5250 Ridge Rd", jobStatusId: "estimating", createdAt: "t", updatedAt: "t",
  }).run()
  db.insert(projectEstimates).values({
    id: "contract", projectId: "squires", estimateNumber: "O-184-5250-00", versionNumber: 3, status: contractStatus,
    marginRateBasisPoints: 1000, createdAt: "t", updatedAt: "t",
  }).run()
  db.insert(projectEstimateAssemblies).values([
    { id: "garage", estimateId: "contract", name: "Garage", sortOrder: 0, createdAt: "t", updatedAt: "t" },
    { id: "house", estimateId: "contract", name: "House", sortOrder: 1, createdAt: "t", updatedAt: "t" },
  ]).run()
  db.insert(projectEstimateLines).values([
    line("g1", "contract", "garage", "03-100", 40_000_00, 0),
    line("g2", "contract", "garage", "06-100", 20_000_00, 1),
    line("h1", "contract", "house", "06-200", 140_000_00, 2),
  ]).run()
}

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = new Database(":memory:")
  for (const table of TABLES) createTable(table)
  mocks.rawDb.current = d1Adapter()
  const db = drizzle(sqlite)
  mocks.getDb.mockReturnValue({
    select: db.select.bind(db), update: db.update.bind(db), insert: db.insert.bind(db), delete: db.delete.bind(db),
    batch: async (queries: readonly { run(): unknown }[]) => sqlite.transaction(() => queries.map((query) => query.run()))(),
  })
  mocks.requireAuth.mockResolvedValue({ id: "user", role: "admin" })
  mocks.assertProjectAccess.mockResolvedValue({ projectNumber: "O-184-5250" })
})
afterEach(() => sqlite.close())

async function exportGarage(): Promise<string> {
  const result = await exportEstimateAssemblyAsPhase("squires", "contract", "garage", "Phase 2 - Garage")
  if (!result.success) throw new Error(result.error)
  return result.id
}

function accept(estimateId: string): void {
  sqlite.prepare("UPDATE project_estimates SET status = 'accepted', signed_at = '2026-10-20' WHERE id = ?").run(estimateId)
}

async function proposalId(): Promise<string> {
  const [proposal] = await getProjectPhaseProposals("squires")
  if (!proposal) throw new Error("No proposal")
  return proposal.id
}

describe("exporting an assembly as a phase", () => {
  it("creates a separate estimate with just the assembly and leaves the contract estimate alone", async () => {
    seed("draft")
    const id = await exportGarage()
    const phase = sqlite.prepare("SELECT estimate_number, version_number, status, title, estimate_total_cents, margin_cents FROM project_estimates WHERE id = ?").get(id)
    // 60k of work plus a 10% margin.
    expect(phase).toEqual({ estimate_number: "O-184-5250-P1", version_number: 1, status: "draft", title: "Phase 2 - Garage", estimate_total_cents: 66_000_00, margin_cents: 6_000_00 })
    expect(sqlite.prepare("SELECT cost_code FROM project_estimate_lines WHERE estimate_id = ? ORDER BY sort_order").all(id)).toEqual([{ cost_code: "03-100" }, { cost_code: "06-100" }])
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_estimate_lines WHERE estimate_id = 'contract'").get()).toEqual({ count: 3 })
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_family_phases").get()).toEqual({ count: 0 })
  })

  it("on acceptance takes the assembly out of a draft contract estimate and adds the phase to a new family", async () => {
    seed("draft")
    accept(await exportGarage())
    const result = await finishPhaseProposal("squires", await proposalId())
    expect(result.success).toBe(true)
    expect(sqlite.prepare("SELECT id FROM project_estimate_lines WHERE estimate_id = 'contract'").all()).toEqual([{ id: "h1" }])
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_estimate_assemblies WHERE estimate_id = 'contract'").get()).toEqual({ count: 1 })
    expect(sqlite.prepare("SELECT estimate_total_cents FROM project_estimates WHERE id = 'contract'").get()).toEqual({ estimate_total_cents: 154_000_00 })
    expect(sqlite.prepare("SELECT sequence, project_id, project_number, name, job_status_id, authorized_contract_amount_cents FROM project_family_phases ORDER BY sequence").all()).toEqual([
      { sequence: 1, project_id: "squires", project_number: "O-184-5250", name: "Ridge Rd - Squires Residence", job_status_id: "estimating", authorized_contract_amount_cents: null },
      { sequence: 2, project_id: null, project_number: "O-184-5250-1", name: "Phase 2 - Garage", job_status_id: "awaiting_funding", authorized_contract_amount_cents: 66_000_00 },
    ])
    const [proposal] = await getProjectPhaseProposals("squires")
    expect(proposal).toMatchObject({ status: "accepted", contractRemoval: "removed_from_estimate", canDelete: false, familyPhase: { projectNumber: "O-184-5250-1" } })
    // Running it again changes nothing.
    expect((await finishPhaseProposal("squires", await proposalId())).success).toBe(true)
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_family_phases").get()).toEqual({ count: 2 })
  })

  it("drafts a deduct change order instead when the contract estimate is signed", async () => {
    seed("accepted")
    accept(await exportGarage())
    expect((await finishPhaseProposal("squires", await proposalId())).success).toBe(true)
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_estimate_lines WHERE estimate_id = 'contract'").get()).toEqual({ count: 3 })
    const changeOrder = sqlite.prepare("SELECT change_order_number, status, amount_cents, budget_treatment FROM project_change_orders").get()
    expect(changeOrder).toEqual({ change_order_number: "O-184-5250-CO-001", status: "draft", amount_cents: -66_000_00, budget_treatment: "additive" })
    expect(sqlite.prepare("SELECT cost_code, amount_cents FROM project_change_order_lines ORDER BY cost_code").all()).toEqual([
      { cost_code: "03-100", amount_cents: -40_000_00 },
      { cost_code: "06-100", amount_cents: -20_000_00 },
      { cost_code: "Company Margin", amount_cents: -6_000_00 },
    ])
    const [proposal] = await getProjectPhaseProposals("squires")
    expect(proposal).toMatchObject({ contractRemoval: "deduct_change_order", deductChangeOrder: { number: "O-184-5250-CO-001" } })
  })

  it("leaves a contract estimate that is out for signature unchanged", async () => {
    seed("signature_pending")
    accept(await exportGarage())
    expect((await finishPhaseProposal("squires", await proposalId())).success).toBe(true)
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_estimate_lines WHERE estimate_id = 'contract'").get()).toEqual({ count: 3 })
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_change_orders").get()).toEqual({ count: 0 })
    const [proposal] = await getProjectPhaseProposals("squires")
    expect(proposal?.contractRemoval).toBe("contract_out_for_signature")
  })

  it("deletes a phase estimate that wasn't accepted without touching the contract estimate", async () => {
    seed("draft")
    const id = await exportGarage()
    expect((await deletePhaseProposal("squires", await proposalId())).success).toBe(true)
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_estimates WHERE id = ?").get(id)).toEqual({ count: 0 })
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_phase_proposals").get()).toEqual({ count: 0 })
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_estimate_lines WHERE estimate_id = 'contract'").get()).toEqual({ count: 3 })
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "budget", "delete")
  })

  it("won't delete an accepted phase estimate or export from a phase estimate", async () => {
    seed("draft")
    const id = await exportGarage()
    const nested = await exportEstimateAssemblyAsPhase("squires", id, "garage", "Nested")
    expect(nested.success).toBe(false)
    accept(id)
    expect((await deletePhaseProposal("squires", await proposalId())).success).toBe(false)
  })
})
