import { describe, expect, it } from "vitest"

import { changeOrderNeedsCompletion, planChangeOrderCompletion } from "@/lib/domain/estimates/rules"

const executed = {
  status: "executed",
  budgetTreatment: "additive",
  kind: null,
  executedAt: "2026-02-04T12:00:00.000Z",
  lines: [{ costCode: "31 23 16", amountCents: 100 }],
}

describe("changeOrderNeedsCompletion", () => {
  it("flags an executed change order with an uncoded line or no execution date", () => {
    expect(changeOrderNeedsCompletion({ ...executed, lines: [{ costCode: null, amountCents: 100 }] })).toBe(true)
    expect(changeOrderNeedsCompletion({ ...executed, executedAt: null })).toBe(true)
    expect(changeOrderNeedsCompletion({ ...executed, lines: [] })).toBe(true)
  })

  it("leaves complete, unexecuted, description-only and rebaseline change orders alone", () => {
    expect(changeOrderNeedsCompletion(executed)).toBe(false)
    expect(changeOrderNeedsCompletion({ ...executed, status: "draft", executedAt: null })).toBe(false)
    expect(changeOrderNeedsCompletion({ ...executed, kind: "description", lines: [] })).toBe(false)
    expect(changeOrderNeedsCompletion({ ...executed, budgetTreatment: "baseline_replacement", lines: [] })).toBe(false)
  })
})

describe("planChangeOrderCompletion", () => {
  const base = {
    amountCents: -141_000,
    allowedCostCodes: new Set(["01 21 16", "01 99 01", "01 99 02"]),
    executedOn: "2026-01-22",
    reason: "Sage progress billing app 8",
    today: "2026-11-06",
  }
  const split = [
    { costCode: "01 99 01", description: "Overhead", amountCents: -63_400 },
    { costCode: "01 99 02", description: "Margin", amountCents: -63_450 },
    { costCode: "01 21 16", description: "Contingency", amountCents: -14_150 },
  ]

  it("accepts a split that adds up to the signed amount", () => {
    const plan = planChangeOrderCompletion({ ...base, lines: split })
    expect(plan).toEqual({ success: true, executedOn: "2026-01-22", reason: "Sage progress billing app 8", lines: split })
  })

  it("refuses a split that doesn't add up, to the cent", () => {
    const lines = split.map((line, index) => (index === 2 ? { ...line, amountCents: -14_100 } : line))
    expect(planChangeOrderCompletion({ ...base, lines })).toEqual({
      success: false,
      error: "The lines total -$1,409.50; they must equal the change order's -$1,410.00.",
    })
  })

  it("refuses cost codes outside the job's list, future dates and a missing reason", () => {
    expect(planChangeOrderCompletion({ ...base, lines: [{ ...split[0], costCode: "99 99 99", amountCents: -141_000 }] }).success).toBe(false)
    expect(planChangeOrderCompletion({ ...base, lines: split, executedOn: "2026-12-01" }).success).toBe(false)
    expect(planChangeOrderCompletion({ ...base, lines: split, reason: "  " }).success).toBe(false)
    expect(planChangeOrderCompletion({ ...base, amountCents: null, lines: split }).success).toBe(false)
  })
})
