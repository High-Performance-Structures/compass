import { describe, expect, it } from "vitest"

import { currentWorkForPercent } from "../pay-application-detail"

const line = {
  costCode: "03 30 02",
  adjustedEstimate: 217576.23,
  previousWorkCompleted: 0,
  storedMaterials: 0,
}

describe("currentWorkForPercent", () => {
  it("bills the percent of the scheduled value", () => {
    expect(currentWorkForPercent(line, 40)).toEqual({
      success: true,
      currentWorkCompleted: 87030.49,
    })
  })

  it("subtracts previous work and stored materials", () => {
    expect(
      currentWorkForPercent(
        { ...line, adjustedEstimate: 1000, previousWorkCompleted: 250, storedMaterials: 50 },
        50
      )
    ).toEqual({ success: true, currentWorkCompleted: 200 })
  })

  it("refuses a percent below what is already billed", () => {
    const result = currentWorkForPercent(
      { ...line, adjustedEstimate: 1000, previousWorkCompleted: 600 },
      50
    )
    expect(result.success).toBe(false)
  })

  it("refuses percents outside 0 to 100", () => {
    expect(currentWorkForPercent(line, 101).success).toBe(false)
    expect(currentWorkForPercent(line, -1).success).toBe(false)
  })
})
