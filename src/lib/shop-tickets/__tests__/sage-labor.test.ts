import { describe, expect, it } from "vitest"
import { compassCostCodeFromSage, groupSageLabor } from "@/lib/shop-tickets/sage-labor"

describe("compassCostCodeFromSage", () => {
  it("reads the code from Sage's name, or from its number", () => {
    expect(compassCostCodeFromSage("3310000.000", "03 31 00 - Structural Concrete")).toBe("03 31 00")
    expect(compassCostCodeFromSage("3300200", null)).toBe("03 30 02")
    expect(compassCostCodeFromSage("31232313.000", "Backfill")).toBe("31 23 23.13")
    expect(compassCostCodeFromSage("508.000", "508 - Business Development")).toBe("508")
    expect(compassCostCodeFromSage("32", "Administrative Fee")).toBe("32")
    expect(compassCostCodeFromSage(null, null)).toBeNull()
  })
})

describe("groupSageLabor", () => {
  const lines = [
    { id: "a", workDate: "2026-09-02", hours: 8, costCode: "03 30 02", sageCostCodeName: "Poured Concrete Walls", employeeName: "Kai" },
    { id: "b", workDate: "2026-09-01", hours: 6.5, costCode: "03 30 02", sageCostCodeName: "Poured Concrete Walls", employeeName: "Wes" },
    { id: "c", workDate: "2026-09-03", hours: 4, costCode: "31 23 23.13", sageCostCodeName: "Backfill", employeeName: "Kai" },
  ]

  it("groups hours by cost code and leaves out hours billed on other tickets", () => {
    const groups = groupSageLabor(lines, new Map([["a", 8], ["c", 1.5]]))
    expect(groups.map((group) => [group.costCode, group.availableHours, group.billedHours])).toEqual([
      ["03 30 02", 6.5, 8],
      ["31 23 23.13", 2.5, 1.5],
    ])
    expect(groups[0]?.lines.map((line) => line.id)).toEqual(["b", "a"])
  })
})
