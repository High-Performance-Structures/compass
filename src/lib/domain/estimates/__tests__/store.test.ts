import { and, eq, like } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { projectChangeOrders } from "@/db/schema"
import { projectEstimateLines, projectEstimates } from "@/db/schema-estimates"
import {
  deleteEstimateLinesStatement,
  insertEstimateLineStatement,
  updateChangeOrdersStatement,
  updateEstimatesStatement,
} from "@/lib/domain/estimates/store"

/*
 * The store writes the same SQL the callers wrote before the move: each
 * statement is compared with the drizzle chain it replaced. Building SQL
 * needs no database connection.
 */
// @ts-expect-error Statements are only built here, never run.
const db = getDb({})

/** The SQL a built statement would run. */
function sqlOf(statement: object): unknown {
  return Reflect.apply(Reflect.get(statement, "getSQL"), statement, [])
}

const now = "2026-10-30T12:00:00.000Z"

describe("estimates store", () => {
  it("updates estimate totals with the same statement", () => {
    const totals = { directCostCents: 100, markupCents: 10, estimateTotalCents: 110, updatedAt: now }
    expect(sqlOf(updateEstimatesStatement(db, eq(projectEstimates.id, "e1"), totals))).toEqual(
      db.update(projectEstimates).set(totals).where(eq(projectEstimates.id, "e1")).getSQL()
    )
  })

  it("inserts one row or several rows with the same statement", () => {
    const row = {
      id: "l1",
      projectId: "p1",
      estimateId: "e1",
      divisionCode: "03",
      divisionName: "Concrete",
      costCode: "03-300",
      costCodeName: "Footings",
      description: "Footings",
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    }
    expect(sqlOf(insertEstimateLineStatement(db, row))).toEqual(db.insert(projectEstimateLines).values(row).getSQL())
    const rows = [row, { ...row, id: "l2" }]
    expect(sqlOf(insertEstimateLineStatement(db, rows))).toEqual(db.insert(projectEstimateLines).values(rows).getSQL())
  })

  it("deletes PlanSwift lines and updates change orders with the same conditions", () => {
    const where = and(eq(projectEstimateLines.estimateId, "e1"), like(projectEstimateLines.specifications, "%PlanSwift source:%"))
    expect(sqlOf(deleteEstimateLinesStatement(db, where))).toEqual(db.delete(projectEstimateLines).where(where).getSQL())
    const changeOrder = and(eq(projectChangeOrders.id, "c1"), eq(projectChangeOrders.projectId, "p1"))
    expect(sqlOf(updateChangeOrdersStatement(db, changeOrder, { changeOrderKind: "estimate", updatedAt: now }))).toEqual(
      db.update(projectChangeOrders).set({ changeOrderKind: "estimate", updatedAt: now }).where(changeOrder).getSQL()
    )
  })
})
