import { describe, expect, it } from "vitest"

import { phoneDailyLogForm, type DailyLogFormSetup } from "@/lib/daily-logs/cost-code-lines"
import { dutyOnPhones } from "@/lib/internal-duties/model"

const codes = [{ code: "01 71 13", name: "Mobilization", label: "01 71 13 Mobilization", group: "" }]
const requirements = { requireCostCodeTime: true, requiredFields: ["crewPresent" as const] }

function setup(phoneCostCodes: DailyLogFormSetup["phoneCostCodes"]): DailyLogFormSetup {
  return { source: "labor", costCodes: codes, phoneCostCodes, requirements }
}

describe("phoneDailyLogForm", () => {
  it("sends a project's phone codes with the company's rules", () => {
    expect(phoneDailyLogForm(setup(codes))).toEqual({
      costCodes: codes,
      requirements: { requireCostCodeTime: true, requiredFields: ["crewPresent"] },
    })
  })

  it("sends nothing for browser-only lists and drops the cost code rule there", () => {
    expect(phoneDailyLogForm(setup([]))).toEqual({
      costCodes: [],
      requirements: { requireCostCodeTime: false, requiredFields: ["crewPresent"] },
    })
  })
})

describe("dutyOnPhones", () => {
  it("offers field duties by default and office duties only when switched on", () => {
    expect(dutyOnPhones({ workspace: "field", active: true })).toBe(true)
    expect(dutyOnPhones({ workspace: "office", active: true })).toBe(false)
    expect(dutyOnPhones({ workspace: "office", active: true, onPhones: true })).toBe(true)
    expect(dutyOnPhones({ workspace: "field", active: true, onPhones: false })).toBe(false)
    expect(dutyOnPhones({ workspace: "office", active: false, onPhones: true })).toBe(false)
  })
})
