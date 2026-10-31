import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { projectContractBudgetRevisions } from "@/db/schema-estimates"
import {
  contractBudgetApplicationNumber,
  contractBudgetProjectionId,
  contractBudgetRevisionPlan,
  nextContractBudgetRevisionNumber,
} from "@/lib/domain/financials/rules"
import {
  insertContractBudgetRevisionStatement,
  makeContractBudgetRevisionCurrentStatement,
  supersedeCurrentContractBudgetRevisionStatement,
} from "@/lib/domain/financials/store"

// @ts-expect-error Statements are only built here, never run.
const db = getDb({})

function toSql(statement: unknown): unknown {
  if (typeof statement !== "object" || statement === null) throw new Error("not a query")
  const build: unknown = Reflect.get(statement, "toSQL")
  if (typeof build !== "function") throw new Error("not a query")
  return Reflect.apply(build, statement, [])
}

describe("contract budget revision rules", () => {
  it("numbers the first revision 1 and each later one past the highest", () => {
    expect(nextContractBudgetRevisionNumber(undefined)).toBe(1)
    expect(nextContractBudgetRevisionNumber(null)).toBe(1)
    expect(nextContractBudgetRevisionNumber(0)).toBe(1)
    expect(nextContractBudgetRevisionNumber(4)).toBe(5)
  })

  it("names the revision's budget projection after it", () => {
    expect(contractBudgetProjectionId("rev-1")).toBe("contract-budget-view:rev-1")
    expect(contractBudgetApplicationNumber(3)).toBe("Contract Budget R3")
  })

  it("keeps a current match, reuses a prepared one, and builds otherwise", () => {
    expect(contractBudgetRevisionPlan("current")).toBe("unchanged")
    expect(contractBudgetRevisionPlan("building")).toBe("reuse")
    expect(contractBudgetRevisionPlan("superseded")).toBe("build")
    expect(contractBudgetRevisionPlan(undefined)).toBe("build")
    expect(contractBudgetRevisionPlan(null)).toBe("build")
  })
})

describe("contract budget revision statements", () => {
  it("supersedes only the project's current revision, as both writers did before", () => {
    const expected = db
      .update(projectContractBudgetRevisions)
      .set({ status: "superseded" })
      .where(
        and(
          eq(projectContractBudgetRevisions.projectId, "p1"),
          eq(projectContractBudgetRevisions.status, "current")
        )
      )
    expect(toSql(supersedeCurrentContractBudgetRevisionStatement(db, "p1"))).toEqual(toSql(expected))
  })

  it("makes exactly the named revision current", () => {
    const expected = db
      .update(projectContractBudgetRevisions)
      .set({ status: "current" })
      .where(eq(projectContractBudgetRevisions.id, "rev-2"))
    expect(toSql(makeContractBudgetRevisionCurrentStatement(db, "rev-2"))).toEqual(toSql(expected))
  })

  it("inserts a revision row as given", () => {
    const row = {
      id: "rev-3",
      projectId: "p1",
      acceptedEstimateId: "e1",
      revisionNumber: 3,
      status: "building",
      originalContractSumCents: 100,
      approvedChangesCents: 0,
      revisedContractSumCents: 100,
      effectiveAt: "t",
      sourceHash: "h",
      createdBy: "u1",
      createdAt: "t",
    }
    const expected = db.insert(projectContractBudgetRevisions).values(row)
    expect(toSql(insertContractBudgetRevisionStatement(db, row))).toEqual(toSql(expected))
  })
})
