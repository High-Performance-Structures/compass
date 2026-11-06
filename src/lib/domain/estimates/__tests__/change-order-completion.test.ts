import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { projectChangeOrderHistory, projectChangeOrderLines, projectChangeOrders } from "@/db/schema"
import { projectContractBudgetAdjustments } from "@/db/schema-estimates"
import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"

vi.mock("@/lib/cost-codes/catalog-server", () => ({
  loadProjectCostCodeChoices: async () => [{ code: "01 99 01" }, { code: "01 99 02" }, { code: "01 21 16" }],
}))
const rebuild = vi.fn(async () => ({ success: false, error: "Choose a signed estimate before building the contract budget." }))
vi.mock("@/lib/financials/contract-budget-store", () => ({ rebuildProjectContractBudget: rebuild }))

const { completeExecutedChangeOrder } = await import("@/lib/domain/estimates/change-order-completion")

/*
 * Completing an imported executed change order replaces its uncoded line with
 * the coded split, dates it, and records history, all in one batch. Tables are
 * built from the Drizzle definitions without foreign keys.
 */

function createTable(table: SQLiteTable): string {
  const config = getTableConfig(table)
  return `CREATE TABLE ${config.name} (${config.columns.map((column) => `${column.name}${column.primary ? " PRIMARY KEY" : ""}`).join(", ")});`
}

const actor = { id: "user-1", name: "Ana Staff", role: "admin" }
const split = [
  { costCode: "01 99 01", description: "Overhead", amountCents: -63_400 },
  { costCode: "01 99 02", description: "Margin", amountCents: -63_450 },
  { costCode: "01 21 16", description: "Contingency", amountCents: -14_150 },
]

function setUp(changeOrder: { readonly executedAt: string | null; readonly lineCostCode: string | null; readonly status?: string }) {
  const { sqlite, db } = sqliteDb(
    [projectChangeOrders, projectChangeOrderLines, projectChangeOrderHistory, projectContractBudgetAdjustments]
      .map(createTable)
      .join("\n")
  )
  sqlite
    .prepare(
      `INSERT INTO project_change_orders (id, project_id, change_order_number, title, scope, amount_cents, status, audience,
        requester_type, requester_name, source_type, budget_treatment, executed_at, foxit_status, sage_status, created_at, updated_at)
       VALUES ('co-1', 'proj-1', 'O-1-0001', 'Overhead & Margin Adjustment', 'scope', -141000, ?, 'owner',
        'contractor', 'HPS', 'buildertrend_import', 'additive', ?, 'not_applicable', 'not_ready', '2026-01-22', '2026-01-22')`
    )
    .run(changeOrder.status ?? "executed", changeOrder.executedAt)
  sqlite
    .prepare(
      `INSERT INTO project_change_order_lines (id, project_id, change_order_id, line_number, description, cost_code, amount_cents, created_at, updated_at)
       VALUES ('line-1', 'proj-1', 'co-1', 1, 'Overhead & Margin Adjustment', ?, -141000, '2026-01-22', '2026-01-22')`
    )
    .run(changeOrder.lineCostCode)
  return { sqlite, db }
}

describe("completeExecutedChangeOrder", () => {
  beforeEach(() => rebuild.mockClear())

  it("replaces the uncoded line with the split, dates it, and records history", async () => {
    const { sqlite, db } = setUp({ executedAt: null, lineCostCode: null })
    const result = await completeExecutedChangeOrder({
      db, projectId: "proj-1", changeOrderId: "co-1", actor, lines: split, executedOn: "2026-01-22", reason: "Sage app 8",
    })

    expect(result).toEqual({ success: true, budgetNote: "Choose a signed estimate before building the contract budget." })
    expect(sqlite.prepare("SELECT line_number, cost_code, amount_cents FROM project_change_order_lines ORDER BY line_number").all()).toEqual([
      { line_number: 1, cost_code: "01 99 01", amount_cents: -63_400 },
      { line_number: 2, cost_code: "01 99 02", amount_cents: -63_450 },
      { line_number: 3, cost_code: "01 21 16", amount_cents: -14_150 },
    ])
    expect(sqlite.prepare("SELECT amount_cents, status, executed_at FROM project_change_orders").get()).toEqual({
      amount_cents: -141_000, status: "executed", executed_at: "2026-01-22T12:00:00.000Z",
    })
    expect(sqlite.prepare("SELECT event_type, note FROM project_change_order_history").all()).toEqual([
      { event_type: "cost_codes_completed", note: "Sage app 8" },
    ])
    expect(rebuild).toHaveBeenCalledWith({ db, projectId: "proj-1", actorUserId: "user-1" })
  })

  it("codes an open imported change order without dating it or rebuilding the budget", async () => {
    const { sqlite, db } = setUp({ executedAt: null, lineCostCode: null, status: "draft" })
    const result = await completeExecutedChangeOrder({
      db, projectId: "proj-1", changeOrderId: "co-1", actor, lines: split, executedOn: "", reason: "Approved and purchased",
    })
    expect(result).toEqual({ success: true, budgetNote: "It will revise the contract budget when it's executed." })
    expect(sqlite.prepare("SELECT count(*) n FROM project_change_order_lines WHERE cost_code IS NOT NULL").get()).toEqual({ n: 3 })
    expect(sqlite.prepare("SELECT status, executed_at FROM project_change_orders").get()).toEqual({ status: "draft", executed_at: null })
    expect(rebuild).not.toHaveBeenCalled()
  })

  it("keeps a recorded execution date", async () => {
    const { sqlite, db } = setUp({ executedAt: "2026-01-20T17:00:00.000Z", lineCostCode: null })
    await completeExecutedChangeOrder({
      db, projectId: "proj-1", changeOrderId: "co-1", actor, lines: split, executedOn: "2026-03-01", reason: "Sage app 8",
    })
    expect(sqlite.prepare("SELECT executed_at FROM project_change_orders").get()).toEqual({ executed_at: "2026-01-20T17:00:00.000Z" })
  })

  it("changes nothing when the split doesn't add up or the change order is already complete", async () => {
    const { sqlite, db } = setUp({ executedAt: null, lineCostCode: null })
    const short = await completeExecutedChangeOrder({
      db, projectId: "proj-1", changeOrderId: "co-1", actor, lines: split.slice(0, 2), executedOn: "2026-01-22", reason: "Sage app 8",
    })
    expect(short.success).toBe(false)
    expect(sqlite.prepare("SELECT cost_code FROM project_change_order_lines").all()).toEqual([{ cost_code: null }])

    const complete = setUp({ executedAt: "2026-01-22T12:00:00.000Z", lineCostCode: "01 99 01" })
    const again = await completeExecutedChangeOrder({
      db: complete.db, projectId: "proj-1", changeOrderId: "co-1", actor, lines: split, executedOn: "2026-01-22", reason: "Sage app 8",
    })
    expect(again).toEqual({ success: false, error: "This change order already has its cost codes and execution date." })
    expect(rebuild).not.toHaveBeenCalled()
  })
})
