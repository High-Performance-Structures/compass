import { describe, expect, it } from "vitest"

import { phoneDailyLogForm, type DailyLogFormSetup } from "@/lib/daily-logs/cost-code-lines"

const codes = [{ code: "01 71 13", name: "Mobilization", label: "01 71 13 Mobilization", group: "" }]
const requirements = { requireCostCodeTime: true, requiredFields: ["crewPresent" as const] }

function setup(source: DailyLogFormSetup["source"]): DailyLogFormSetup {
  return { source, costCodes: codes, requirements }
}

describe("phoneDailyLogForm", () => {
  it("sends the labor list and the yards' duties to phones", () => {
    expect(phoneDailyLogForm(setup("labor"))).toEqual({ costCodes: codes, requirements: { requireCostCodeTime: true, requiredFields: ["crewPresent"] } })
    expect(phoneDailyLogForm(setup("yard-duties")).costCodes).toEqual(codes)
  })

  it.each(["company", "duties"] as const)("keeps the %s list off phones and drops the cost code rule there", (source) => {
    expect(phoneDailyLogForm(setup(source))).toEqual({
      costCodes: [],
      requirements: { requireCostCodeTime: false, requiredFields: ["crewPresent"] },
    })
  })
})
