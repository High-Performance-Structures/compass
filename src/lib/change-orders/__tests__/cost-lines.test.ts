import { describe, expect, it } from "vitest"

import {
  changeOrderCostLinesTotalCents,
  cleanChangeOrderCostLines,
  cleanScheduleImpactDays,
} from "@/lib/change-orders/cost-lines"

describe("change order cost lines", () => {
  it("drops empty rows and preserves selected coding", () => {
    expect(
      cleanChangeOrderCostLines([
        {
          description: null,
          phaseCode: null,
          costCode: null,
          amountCents: null,
        },
        {
          description: "  Added casework  ",
          phaseCode: "12",
          costCode: "12 32 00",
          amountCents: 125_050,
        },
      ])
    ).toEqual([
      {
        lineNumber: 1,
        description: "Added casework",
        phaseCode: "12",
        costCode: "12 32 00",
        amountCents: 125_050,
      },
    ])
  })

  it("calculates signed totals for additions and credits", () => {
    expect(
      changeOrderCostLinesTotalCents([
        { amountCents: 250_000 },
        { amountCents: -25_000 },
      ])
    ).toBe(225_000)
    expect(changeOrderCostLinesTotalCents([])).toBeNull()
    expect(
      changeOrderCostLinesTotalCents([{ amountCents: null }])
    ).toBeNull()
  })

  it("requires descriptions on populated lines", () => {
    expect(() =>
      cleanChangeOrderCostLines([
        {
          description: null,
          phaseCode: null,
          costCode: "03 30 00",
          amountCents: 500,
        },
      ])
    ).toThrow("Line 1 needs a description")
    expect(() =>
      cleanChangeOrderCostLines([
        {
          description: "Invalid pricing",
          phaseCode: null,
          costCode: null,
          amountCents: Number.NaN,
        },
      ])
    ).toThrow("Line amount is invalid")
  })

  it("accepts bounded whole-day schedule impacts", () => {
    expect(cleanScheduleImpactDays(null)).toBeNull()
    expect(cleanScheduleImpactDays(0)).toBe(0)
    expect(cleanScheduleImpactDays(45)).toBe(45)
    expect(() => cleanScheduleImpactDays(1.5)).toThrow("whole number")
    expect(() => cleanScheduleImpactDays(-1)).toThrow("whole number")
  })
})
