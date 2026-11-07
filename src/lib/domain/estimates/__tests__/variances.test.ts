import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { eq } from "drizzle-orm"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  projectBudgetApplications,
  projectBudgetLines,
  projectChangeOrderHistory,
  projectChangeOrderLines,
  projectChangeOrders,
  projects,
  sageCostCodes,
} from "@/db/schema"
import {
  projectContractBudgetAdjustments,
  projectContractBudgetLines,
  projectContractBudgetRevisions,
  projectEstimateAssemblies,
  projectEstimateLines,
  projectEstimates,
} from "@/db/schema-estimates"
import { payApplicationShopTicketImports } from "@/db/schema-shop-tickets"
import type { ProjectContractType } from "@/lib/domain/project/statuses"

vi.mock("@/lib/cost-codes/catalog-server", () => ({
  loadProjectCostCodeChoices: vi.fn(async () => [{ code: "06 10 00" }, { code: "09 91 00" }]),
}))
vi.mock("@/lib/activity-log", () => ({
  activityActorName: (actor: { displayName?: string | null; email: string }) => actor.displayName ?? actor.email,
  recordActivityEvent: vi.fn(async () => undefined),
}))

import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import { approveVariance, createVariance, reclassifyChangeOrders, saveVarianceLines } from "@/lib/domain/estimates/variances"

const TABLES: readonly SQLiteTable[] = [
  projects, projectChangeOrders, projectChangeOrderLines, projectChangeOrderHistory, projectEstimates, projectEstimateLines,
  projectEstimateAssemblies, projectContractBudgetRevisions, projectContractBudgetLines, projectContractBudgetAdjustments,
  projectBudgetApplications, projectBudgetLines, sageCostCodes, payApplicationShopTicketImports,
]

let sqlite: InstanceType<typeof Database>
let db: ReturnType<typeof makeDb>
const actor = { id: "staff-1", role: "admin", displayName: "Pat Estimator", email: "pat@example.com", firstName: null, lastName: null }

function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table)
  const columns = config.columns.map((column) => {
    const value = column.default
    const defaultSql = typeof value === "number" ? ` DEFAULT ${value}` : typeof value === "boolean" ? ` DEFAULT ${Number(value)}` : typeof value === "string" ? ` DEFAULT '${value.replaceAll("'", "''")}'` : ""
    return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`
  })
  sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`)
}

function makeDb() {
  const inner = drizzle(sqlite)
  return Object.assign(inner, {
    batch: async (queries: readonly { run(): unknown }[]) => sqlite.transaction(() => queries.map((query) => query.run()))(),
  })
}

// The tests pass this in-memory database where the domain expects D1.
function d1(): Parameters<typeof createVariance>[0]["db"] {
  // @ts-expect-error better-sqlite3 drizzle stands in for D1 in tests
  return db
}

const now = "2026-10-01T12:00:00.000Z"

async function setUp(contractType: ProjectContractType): Promise<void> {
  db.insert(projects).values({ id: "job", name: "Example Residence", projectNumber: "O-100-1000", contractType, createdAt: now, updatedAt: now }).run()
  db.insert(projectEstimates).values({
    id: "est", projectId: "job", estimateNumber: "E-1", status: "accepted",
    overheadRateBasisPoints: 1_000, marginRateBasisPoints: 500, overheadCents: 10_000_00, marginCents: 5_000_00,
    builderFeeCents: 15_000_00, createdAt: now, updatedAt: now,
  }).run()
  const line = { estimateId: "est", projectId: "job", divisionName: "Division", costCodeName: "Code", markupCents: 0, taxCents: 0, sortOrder: 1, createdAt: now, updatedAt: now }
  db.insert(projectEstimateLines).values([
    { ...line, id: "l-frame", divisionCode: "06", costCode: "06 10 00", description: "Rough Carpentry", directCostCents: 100_000_00, lineTotalCents: 100_000_00 },
    { ...line, id: "l-paint", divisionCode: "09", costCode: "09 91 00", description: "Painting", directCostCents: 15_000_00, lineTotalCents: 15_000_00 },
    // Insurance is 2% of the rest of the contract (100,000 + 15,000 + 15,000 fee).
    { ...line, id: "l-ins", divisionCode: "00", costCode: "00 73 16", description: "Project Liability Insurance", directCostCents: 2_600_00, lineTotalCents: 2_600_00, includeInBuilderFee: false },
  ]).run()
  const built = await rebuildProjectContractBudget({ db: d1(), projectId: "job", actorUserId: "staff-1" })
  expect(built.success).toBe(true)
}

async function approvedVariance(amountCents: number): Promise<string> {
  const created = await createVariance({ db: d1(), projectId: "job", actor, title: "Lumber price increase", scope: "Framing lumber up.", reason: null })
  if (!created.success) throw new Error(created.error)
  const saved = await saveVarianceLines({ db: d1(), projectId: "job", changeOrderId: created.id, actor, lines: [{ costCode: "06 10 00", description: "Lumber", amountCents }] })
  expect(saved.success).toBe(true)
  const approved = await approveVariance({ db: d1(), projectId: "job", changeOrderId: created.id, actor })
  expect(approved).toMatchObject({ success: true, budgetNote: null })
  return created.id
}

function lines(changeOrderId: string) {
  return db.select().from(projectChangeOrderLines).where(eq(projectChangeOrderLines.changeOrderId, changeOrderId)).all()
}

function currentRevision() {
  return db.select().from(projectContractBudgetRevisions).where(eq(projectContractBudgetRevisions.status, "current")).get()
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  for (const table of TABLES) createTable(table)
  db = makeDb()
})
afterEach(() => sqlite.close())

describe("variances", () => {
  it("adds the builder fee and insurance on straight cost plus, and the budget rebuild includes the approved variance", async () => {
    await setUp("cost_plus")
    const id = await approvedVariance(10_000_00)
    const derived = lines(id).filter((line) => line.derivedFrom !== null)
    expect(derived.map((line) => [line.derivedFrom, line.costCode, line.amountCents])).toEqual([
      ["builder_fee", "Company Overhead", 1_000_00],
      ["builder_fee", "Company Margin", 500_00],
      // 2% of the 11,500 moved, on the contract's own insurance line.
      ["insurance", "00 73 16", 230_00],
    ])
    const record = db.select().from(projectChangeOrders).where(eq(projectChangeOrders.id, id)).get()
    expect(record).toMatchObject({ changeOrderNumber: "V-001", recordType: "variance", status: "executed", amountCents: 11_730_00 })
    const revision = currentRevision()
    expect(revision?.approvedChangesCents).toBe(11_730_00)
    const framing = db.select().from(projectContractBudgetLines).where(eq(projectContractBudgetLines.revisionId, revision?.id ?? "")).all()
      .find((line) => line.costCode === "06 10 00")
    expect(framing).toMatchObject({ originalEstimateCents: 100_000_00, approvedChangeCents: 10_000_00, adjustedBudgetCents: 110_000_00 })
  })

  it("leaves the fee alone on cost plus fixed fee but still adds insurance", async () => {
    await setUp("cost_plus_fixed_fee")
    const id = await approvedVariance(-5_000_00)
    expect(lines(id).filter((line) => line.derivedFrom !== null).map((line) => [line.derivedFrom, line.amountCents])).toEqual([["insurance", -100_00]])
    expect(currentRevision()?.approvedChangesCents).toBe(-5_100_00)
  })

  it("rejects variances on a fixed-price job", async () => {
    await setUp("fixed_price")
    const created = await createVariance({ db: d1(), projectId: "job", actor, title: "Lumber", scope: "Up.", reason: null })
    expect(created).toEqual({ success: false, error: "This job is fixed price; price changes go through a change order." })
  })

  it("never changes a closed project", async () => {
    await setUp("cost_plus")
    db.update(projects).set({ jobStatusId: "closed" }).where(eq(projects.id, "job")).run()
    const created = await createVariance({ db: d1(), projectId: "job", actor, title: "Lumber", scope: "Up.", reason: null })
    expect(created).toEqual({ success: false, error: "This project is closed, so it can't change." })
  })

  it("reclassifies monthly change orders as variances numbered in date order, and back", async () => {
    await setUp("cost_plus_fixed_fee")
    const base = { projectId: "job", title: "", scope: "Monthly variances", requesterType: "internal", requesterName: "Pat", sourceType: "internal_request", createdAt: now, updatedAt: now }
    db.insert(projectChangeOrders).values([
      { ...base, id: "co-1", changeOrderNumber: "O-100-1000-CO-001", title: "Owner upgrade", status: "draft" },
      { ...base, id: "co-2", changeOrderNumber: "O-100-1000-CO-002", title: "September Variances", status: "executed", executedAt: "2026-09-30T12:00:00.000Z" },
      { ...base, id: "co-3", changeOrderNumber: "O-100-1000-CO-003", title: "August Variances", status: "executed", executedAt: "2026-08-31T12:00:00.000Z" },
    ]).run()
    db.insert(projectChangeOrderLines).values([
      { id: "x-2", projectId: "job", changeOrderId: "co-2", lineNumber: 1, description: "Paint", costCode: "09 91 00", amountCents: 700_00, createdAt: now, updatedAt: now },
      { id: "x-3", projectId: "job", changeOrderId: "co-3", lineNumber: 1, description: "Lumber", costCode: "06 10 00", amountCents: 300_00, createdAt: now, updatedAt: now },
    ]).run()
    const result = await reclassifyChangeOrders({ db: d1(), projectId: "job", changeOrderIds: ["co-2", "co-3"], to: "variance", actor })
    expect(result).toEqual({ success: true, count: 2, budgetNote: null })
    const rows = db.select().from(projectChangeOrders).all()
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect([byId.get("co-3")?.changeOrderNumber, byId.get("co-2")?.changeOrderNumber]).toEqual(["V-001", "V-002"])
    expect(byId.get("co-3")?.formerChangeOrderNumber).toBe("O-100-1000-CO-003")
    // Amounts are unchanged; the budget still carries both.
    expect(currentRevision()?.approvedChangesCents).toBe(1_000_00)

    // A new variance takes the next V-number; change orders never reuse CO-003.
    const created = await createVariance({ db: d1(), projectId: "job", actor, title: "Steel", scope: "Down.", reason: null })
    if (!created.success) throw new Error(created.error)
    expect(db.select().from(projectChangeOrders).where(eq(projectChangeOrders.id, created.id)).get()?.changeOrderNumber).toBe("V-003")

    const back = await reclassifyChangeOrders({ db: d1(), projectId: "job", changeOrderIds: ["co-2"], to: "change_order", actor })
    expect(back.success).toBe(true)
    expect(db.select().from(projectChangeOrders).where(eq(projectChangeOrders.id, "co-2")).get()).toMatchObject({
      recordType: "change_order",
      changeOrderNumber: "O-100-1000-CO-002",
      formerChangeOrderNumber: null,
    })
  })
})
