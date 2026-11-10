import { describe, expect, it } from "vitest"

import {
  PAY_REQUEST_WORK_AREAS,
  parsePayRequestWorkArea,
  payRequestGroupsOpenByDefault,
  sageReconciliationNeedsAttention,
} from "../pay-request-work-areas"

describe("parsePayRequestWorkArea", () => {
  it("opens Billing when ?work= is missing or unknown", () => {
    expect(parsePayRequestWorkArea(undefined)).toBe("billing")
    expect(parsePayRequestWorkArea(null)).toBe("billing")
    expect(parsePayRequestWorkArea("")).toBe("billing")
    expect(parsePayRequestWorkArea("invoices")).toBe("billing")
    expect(parsePayRequestWorkArea("SAGE")).toBe("billing")
  })

  it("reads every listed area, and the first of repeated params", () => {
    for (const area of PAY_REQUEST_WORK_AREAS) expect(parsePayRequestWorkArea(area.value)).toBe(area.value)
    expect(parsePayRequestWorkArea(["payments", "sage"])).toBe("payments")
    expect(parsePayRequestWorkArea([])).toBe("billing")
  })
})

describe("payRequestGroupsOpenByDefault", () => {
  const line = (adjustedEstimate: number, totalCompletedStored: number) => ({ adjustedEstimate, totalCompletedStored })

  it("folds every group that bills within its scheduled value", () => {
    expect(
      payRequestGroupsOpenByDefault([
        { id: "division:03", lines: [line(1_000, 500), line(2_000, 2_000)] },
        { id: "division:09", lines: [line(800, 0)] },
      ])
    ).toEqual([])
  })

  it("opens only the groups holding an over-billed line", () => {
    expect(
      payRequestGroupsOpenByDefault([
        { id: "assembly:a", lines: [line(1_000, 500)] },
        { id: "assembly:b", lines: [line(1_000, 1_000), line(8_000, 10_000)] },
        { id: "assembly:", lines: [line(100.1, 100.10000000001)] },
      ])
    ).toEqual(["assembly:b"])
  })
})

describe("sageReconciliationNeedsAttention", () => {
  it("opens the comparison only on a mismatch", () => {
    expect(sageReconciliationNeedsAttention(null)).toBe(false)
    expect(sageReconciliationNeedsAttention({ mismatchCount: 0, totals: { mismatch: false } })).toBe(false)
    expect(sageReconciliationNeedsAttention({ mismatchCount: 2, totals: { mismatch: false } })).toBe(true)
    expect(sageReconciliationNeedsAttention({ mismatchCount: 0, totals: { mismatch: true } })).toBe(true)
  })
})
