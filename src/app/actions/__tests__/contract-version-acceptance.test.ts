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
  projectOperations,
  projects,
  sageCostCodes,
} from "@/db/schema"
import { invoices, payments, vendorBills } from "@/db/schema-netsuite"
import {
  projectContractBudgetAdjustments,
  projectContractBudgetLines,
  projectContractBudgetRevisions,
  projectEstimateLines,
  projectEstimates,
} from "@/db/schema-estimates"

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  requireFeaturePermission: vi.fn(),
  assertProjectAccess: vi.fn(),
  recordActivityEvent: vi.fn(),
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, getCurrentUser: mocks.requireAuth }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission, can: () => true }))
vi.mock("@/lib/permission-enforcement", () => ({
  requireFeaturePermission: mocks.requireFeaturePermission,
  canFeature: vi.fn(async () => true),
}))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/activity-log", () => ({
  recordActivityEvent: mocks.recordActivityEvent,
  activityActorName: () => "Estimator",
}))
vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn(async () => ({ env: { DB: {} } })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  getContractVersionAcceptancePreview,
  recordManualProjectEstimateAcceptance,
} from "@/app/actions/project-estimates"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import { getDb } from "@/db"

let sqlite: InstanceType<typeof Database>

const TABLES: readonly SQLiteTable[] = [
  projects, projectEstimates, projectEstimateLines, projectChangeOrders, projectChangeOrderLines,
  projectChangeOrderHistory, projectContractBudgetRevisions, projectContractBudgetLines,
  projectContractBudgetAdjustments, projectBudgetApplications, projectBudgetLines, projectOperations,
  sageCostCodes, invoices, payments, vendorBills,
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

function line(id: string, estimateId: string, costCode: string, cents: number, sortOrder: number) {
  return {
    id, projectId: "hinson", estimateId, divisionCode: costCode.slice(0, 2), divisionName: "Division",
    costCode, costCodeName: costCode, description: `Work ${costCode}`, directCostCents: cents, lineTotalCents: cents,
    includeInBuilderFee: false, sortOrder, createdAt: "t", updatedAt: "t",
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  sqlite = new Database(":memory:")
  for (const table of TABLES) createTable(table)
  const db = drizzle(sqlite)
  mocks.getDb.mockReturnValue({
    select: db.select.bind(db), update: db.update.bind(db), insert: db.insert.bind(db), delete: db.delete.bind(db),
    batch: async (queries: readonly { run(): unknown }[]) => sqlite.transaction(() => queries.map((query) => query.run()))(),
  })
  mocks.requireAuth.mockResolvedValue({ id: "user", role: "admin", organizationId: null })
  mocks.assertProjectAccess.mockResolvedValue({ projectNumber: "O-166-2750" })

  db.insert(projects).values({ id: "hinson", name: "Hinson Residence", projectNumber: "O-166-2750", createdAt: "t", updatedAt: "t" }).run()
  db.insert(projectEstimates).values([
    { id: "v1", projectId: "hinson", estimateNumber: "O-166-2750-00", versionNumber: 1, status: "accepted", estimateTotalCents: 1_000_00, createdAt: "t", updatedAt: "t" },
    { id: "v2", projectId: "hinson", estimateNumber: "O-166-2750-00", versionNumber: 2, status: "signature_pending", estimateTotalCents: 900_00, createdAt: "t", updatedAt: "t" },
  ]).run()
  db.insert(projectEstimateLines).values([
    line("a1", "v1", "01-100", 300_00, 0),
    line("a2", "v1", "02-100", 200_00, 1),
    line("a3", "v1", "06-100", 500_00, 2),
    line("b1", "v2", "01-100", 300_00, 0),
    line("b3", "v2", "06-100", 550_00, 1),
    line("b4", "v2", "07-100", 50_00, 2),
  ]).run()
  // The v1 contract budget, as it stands before v2 is accepted.
  const budget = await rebuildProjectContractBudget({ db: getDb({} as never), projectId: "hinson", actorUserId: "user" })
  if (!budget.success) throw new Error(budget.error)
})
afterEach(() => sqlite.close())

function accept(treatment: string | null) {
  return recordManualProjectEstimateAcceptance("hinson", "v2", {
    acceptanceMethod: "wet_signature",
    clientAcceptedAt: "2026-10-24",
    evidenceUrl: "https://drive.google.com/file/d/signed",
    evidenceLabel: "Signed v2",
    acceptanceNote: null,
    attested: true,
    versionTreatment: treatment,
    versionSummary: "Plans revised; preconstruction items removed for the lender.",
  })
}

function currentBudget() {
  return sqlite
    .prepare("SELECT accepted_estimate_id, original_contract_sum_cents, approved_changes_cents, revised_contract_sum_cents FROM project_contract_budget_revisions WHERE status = 'current'")
    .get()
}

function estimateStatuses() {
  return sqlite.prepare("SELECT id, status FROM project_estimates ORDER BY id").all()
}

describe("accepting a newer contract-estimate version", () => {
  it("previews the line-by-line differences", async () => {
    const result = await getContractVersionAcceptancePreview("hinson", "v2")
    expect(result).toMatchObject({
      success: true,
      preview: {
        replacesContract: true,
        baseline: { versionNumber: 1, totalCents: 1_000_00 },
        newTotalCents: 900_00,
        netChangeCents: -100_00,
        replaceBlockers: [],
      },
    })
    if (!result.success || !result.preview.replacesContract) throw new Error("No preview")
    expect(result.preview.lines.map((item) => [item.kind, item.costCode, item.amountCents])).toEqual([
      ["removed", "02-100", -200_00],
      ["changed", "06-100", 50_00],
      ["added", "07-100", 50_00],
    ])
  })

  it("requires a choice instead of silently replacing the contract", async () => {
    const result = await accept(null)
    expect(result).toEqual({ success: false, error: "Choose whether this version replaces the contract or becomes a change order." })
    expect(estimateStatuses()).toEqual([{ id: "v1", status: "accepted" }, { id: "v2", status: "signature_pending" }])
  })

  it("keeps the original contract and adds an executed change order for the differences", async () => {
    expect((await accept("difference_change_order")).success).toBe(true)
    expect(estimateStatuses()).toEqual([{ id: "v1", status: "superseded" }, { id: "v2", status: "accepted" }])
    expect(sqlite.prepare("SELECT change_order_number, status, budget_treatment, amount_cents, baseline_estimate_id, replacement_estimate_id FROM project_change_orders").get()).toEqual({
      change_order_number: "O-166-2750-CO-001", status: "executed", budget_treatment: "additive", amount_cents: -100_00,
      baseline_estimate_id: "v1", replacement_estimate_id: "v2",
    })
    expect(sqlite.prepare("SELECT cost_code, change_kind, previous_amount_cents, new_amount_cents, amount_cents FROM project_change_order_lines ORDER BY line_number").all()).toEqual([
      { cost_code: "02-100", change_kind: "removed", previous_amount_cents: 200_00, new_amount_cents: 0, amount_cents: -200_00 },
      { cost_code: "06-100", change_kind: "changed", previous_amount_cents: 500_00, new_amount_cents: 550_00, amount_cents: 50_00 },
      { cost_code: "07-100", change_kind: "added", previous_amount_cents: 0, new_amount_cents: 50_00, amount_cents: 50_00 },
    ])
    // Original contract sum stays v1; the change order carries the difference.
    expect(currentBudget()).toEqual({ accepted_estimate_id: "v2", original_contract_sum_cents: 1_000_00, approved_changes_cents: -100_00, revised_contract_sum_cents: 900_00 })
  })

  it("replaces the contract through an executed replacement change order", async () => {
    expect((await accept("replace_contract")).success).toBe(true)
    expect(estimateStatuses()).toEqual([{ id: "v1", status: "superseded" }, { id: "v2", status: "accepted" }])
    expect(sqlite.prepare("SELECT status, budget_treatment, audience, scope, rebaseline_completed_by FROM project_change_orders").get()).toEqual({
      status: "executed", budget_treatment: "baseline_replacement", audience: "owner",
      scope: "Plans revised; preconstruction items removed for the lender.", rebaseline_completed_by: "user",
    })
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_change_order_lines").get()).toEqual({ count: 3 })
    // The budget is rebuilt from v2; the listed differences don't add to it.
    expect(currentBudget()).toEqual({ accepted_estimate_id: "v2", original_contract_sum_cents: 900_00, approved_changes_cents: 0, revised_contract_sum_cents: 900_00 })
  })

  it("lets preconstruction billing sit beside the contract, but construction billing blocks a replacement", async () => {
    const db = drizzle(sqlite)
    db.insert(invoices).values({ id: "design", customerId: "c", projectId: "hinson", issueDate: "2025-06-23", total: 6_536.4, billingScope: "preconstruction", createdAt: "t", updatedAt: "t" }).run()
    db.insert(payments).values({ id: "design-paid", projectId: "hinson", paymentType: "received", amount: 6_536.4, paymentDate: "2025-07-01", billingScope: "preconstruction", createdAt: "t", updatedAt: "t" }).run()
    const preview = await getContractVersionAcceptancePreview("hinson", "v2")
    expect(preview).toMatchObject({ success: true, preview: { replaceBlockers: [] } })

    db.insert(invoices).values({ id: "draw-1", customerId: "c", projectId: "hinson", issueDate: "2026-10-01", total: 50_000, createdAt: "t", updatedAt: "t" }).run()
    const result = await accept("replace_contract")
    expect(result.success).toBe(false)
    expect(result.success ? "" : result.error).toContain("An invoice or payment already exists for this project.")
    expect(estimateStatuses()).toEqual([{ id: "v1", status: "accepted" }, { id: "v2", status: "signature_pending" }])
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM project_change_orders").get()).toEqual({ count: 0 })
  })

  it("needs change-order approval permission to change the contract", async () => {
    mocks.requireFeaturePermission.mockRejectedValueOnce(new Error("Change-order approval permission is required."))
    expect(await accept("difference_change_order")).toEqual({ success: false, error: "Change-order approval permission is required." })
    expect(mocks.requireFeaturePermission).toHaveBeenCalledWith(expect.anything(), "change-orders", "approve")
  })
})
