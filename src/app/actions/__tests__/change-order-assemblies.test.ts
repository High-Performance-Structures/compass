import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  projectBudgetApplications,
  projectBudgetLines,
  projectChangeOrderHistory,
  projectChangeOrderLines,
  projectChangeOrders,
  projectContacts,
  projectOperations,
  projects,
  sageCostCodes,
} from "@/db/schema"
import { invoices, payments, vendorBills } from "@/db/schema-netsuite"
import {
  projectContractBudgetAdjustments,
  projectContractBudgetLines,
  projectContractBudgetRevisions,
  projectEstimateAssemblies,
  projectEstimateLines,
  projectEstimateReportPhases,
  projectEstimates,
} from "@/db/schema-estimates"

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  assertProjectAccess: vi.fn(),
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/permissions", () => ({ requirePermission: vi.fn(), can: () => true }))
vi.mock("@/lib/permission-enforcement", () => ({
  requireFeaturePermission: vi.fn(async () => undefined),
  canFeature: vi.fn(async () => true),
}))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: vi.fn(), activityActorName: () => "Estimator" }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn(async () => ({ env: { DB: {} } })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { getDb } from "@/db"
import { createChangeOrderEstimateDraft, recordManualProjectEstimateAcceptance } from "@/app/actions/project-estimates"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import { loadPayApplicationShares } from "@/lib/financials/pay-application-shares"

let sqlite: InstanceType<typeof Database>

const TABLES: readonly SQLiteTable[] = [
  projects, projectContacts, projectEstimates, projectEstimateLines, projectEstimateAssemblies, projectEstimateReportPhases,
  projectChangeOrders, projectChangeOrderLines, projectChangeOrderHistory, projectContractBudgetRevisions,
  projectContractBudgetLines, projectContractBudgetAdjustments, projectBudgetApplications, projectBudgetLines,
  projectOperations, sageCostCodes, invoices, payments, vendorBills,
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

function line(id: string, estimateId: string, assemblyId: string | null, costCode: string, cents: number, reportPhaseId: string | null = null) {
  return {
    id, projectId: "job", estimateId, assemblyId, reportPhaseId, divisionCode: costCode.slice(0, 2), divisionName: "Division",
    costCode, costCodeName: costCode, description: `Work ${costCode}`, directCostCents: cents, lineTotalCents: cents,
    includeInBuilderFee: false, sortOrder: 0, createdAt: "t", updatedAt: "t",
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  sqlite = new Database(":memory:")
  for (const table of TABLES) createTable(table)
  const db = drizzle(sqlite)
  mocks.getDb.mockReturnValue({
    select: db.select.bind(db), selectDistinct: db.selectDistinct.bind(db), update: db.update.bind(db),
    insert: db.insert.bind(db), delete: db.delete.bind(db),
    batch: async (queries: readonly { run(): unknown }[]) => sqlite.transaction(() => queries.map((query) => query.run()))(),
  })
  mocks.requireAuth.mockResolvedValue({ id: "staff", role: "admin", organizationId: null })
  mocks.assertProjectAccess.mockResolvedValue({ projectNumber: "O-166-2750" })

  db.insert(projects).values({ id: "job", name: "Residence", projectNumber: "O-166-2750", createdAt: "t", updatedAt: "t" }).run()
  db.insert(projectEstimates).values({
    id: "contract", projectId: "job", estimateNumber: "O-166-2750-00", versionNumber: 1, status: "accepted",
    estimateTotalCents: 1_300_00, createdAt: "t", updatedAt: "t",
  }).run()
  db.insert(projectEstimateAssemblies).values([
    { id: "kitchen", estimateId: "contract", name: "Kitchen", sortOrder: 1, createdAt: "t", updatedAt: "t" },
    { id: "framing", estimateId: "contract", name: "Framing", sortOrder: 2, createdAt: "t", updatedAt: "t" },
  ]).run()
  db.insert(projectEstimateReportPhases).values({
    id: "finishes", projectId: "job", estimateId: "contract", divisionCode: "06", name: "Finishes", createdAt: "t", updatedAt: "t",
  }).run()
  db.insert(projectEstimateLines).values([
    line("k1", "contract", "kitchen", "06-400", 1_000_00, "finishes"),
    line("f1", "contract", "framing", "06-100", 300_00),
  ]).run()
  db.insert(projectChangeOrders).values({
    id: "co", projectId: "job", changeOrderNumber: "O-166-2750-CO-001", title: "Island", scope: "Bigger island",
    status: "draft", audience: "owner", requesterType: "internal", requesterName: "Estimator", sourceType: "internal_request",
    budgetTreatment: "additive", changeOrderKind: "estimate", foxitStatus: "not_started", sageStatus: "not_ready",
    createdAt: "t", updatedAt: "t",
  }).run()
  const budget = await rebuildProjectContractBudget({ db: getDb({} as never), projectId: "job", actorUserId: "staff" })
  if (!budget.success) throw new Error(budget.error)
})
afterEach(() => sqlite.close())

describe("change-order estimates tied to contract assemblies", () => {
  it("starts with the chosen contract assemblies and their report phases", async () => {
    const result = await createChangeOrderEstimateDraft("job", "co", ["kitchen"])
    expect(result.success).toBe(true)
    expect(sqlite.prepare("SELECT name, contract_assembly_id FROM project_estimate_assemblies WHERE estimate_id <> 'contract'").all()).toEqual([
      { name: "Kitchen", contract_assembly_id: "kitchen" },
    ])
    expect(sqlite.prepare("SELECT name FROM project_estimate_report_phases WHERE estimate_id <> 'contract'").all()).toEqual([{ name: "Finishes" }])
    expect(await createChangeOrderEstimateDraft("job", "co", ["not-a-contract-assembly"])).toMatchObject({ success: true })
  })

  it("refuses assemblies that aren't in the accepted contract estimate", async () => {
    expect(await createChangeOrderEstimateDraft("job", "co", ["elsewhere"])).toEqual({
      success: false,
      error: "Choose assemblies from the accepted contract estimate.",
    })
  })

  it("puts the accepted change inside the contract assembly on the pay application", async () => {
    const draft = await createChangeOrderEstimateDraft("job", "co", ["kitchen"])
    if (!draft.success || !draft.id) throw new Error("No draft")
    const coKitchen = sqlite.prepare("SELECT id FROM project_estimate_assemblies WHERE estimate_id = ?").get(draft.id)
    const coKitchenId = typeof coKitchen === "object" && coKitchen && "id" in coKitchen && typeof coKitchen.id === "string" ? coKitchen.id : ""
    const db = drizzle(sqlite)
    db.insert(projectEstimateAssemblies).values({ id: "deck", estimateId: draft.id, name: "Deck", sortOrder: 9, createdAt: "t", updatedAt: "t" }).run()
    db.insert(projectEstimateLines).values([
      line("c1", draft.id, coKitchenId, "06-400", 85_00),
      line("c2", draft.id, "deck", "06-150", 40_00),
    ]).run()
    sqlite.prepare("UPDATE project_estimates SET status = 'signature_pending', estimate_total_cents = 12500 WHERE id = ?").run(draft.id)

    const accepted = await recordManualProjectEstimateAcceptance("job", draft.id, {
      acceptanceMethod: "wet_signature", clientAcceptedAt: "2026-10-24", evidenceUrl: "https://drive.google.com/file/d/co",
      evidenceLabel: "Signed CO", acceptanceNote: null, attested: true, versionTreatment: null, versionSummary: null,
    })
    expect(accepted.success).toBe(true)
    expect(sqlite.prepare("SELECT cost_code, assembly_name, contract_assembly_id, amount_cents FROM project_change_order_lines ORDER BY cost_code").all()).toEqual([
      { cost_code: "06-150", assembly_name: "Deck", contract_assembly_id: null, amount_cents: 40_00 },
      { cost_code: "06-400", assembly_name: "Kitchen", contract_assembly_id: "kitchen", amount_cents: 85_00 },
    ])

    const revision = sqlite.prepare("SELECT id FROM project_contract_budget_revisions WHERE status = 'current'").get()
    const revisionId = typeof revision === "object" && revision && "id" in revision && typeof revision.id === "string" ? revision.id : ""
    const shares = await loadPayApplicationShares(getDb({} as never), revisionId)
    expect(shares.map((share) => [share.assemblyName, share.costCode, share.originalEstimateCents, share.approvedChangeCents])).toEqual(
      expect.arrayContaining([
        ["Kitchen", "06-400", 1_000_00, 85_00],
        ["Framing", "06-100", 300_00, 0],
        ["Change order O-166-2750-CO-001 · Island", "06-150", 0, 40_00],
      ])
    )
  })
})
