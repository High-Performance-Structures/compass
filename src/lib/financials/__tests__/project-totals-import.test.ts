import { describe, expect, it } from "vitest"

import {
  parseProjectTotalsRows,
  spreadsheetIdFromUrl,
} from "@/lib/financials/project-totals-import"

describe("parseProjectTotalsRows", () => {
  it("imports cost codes and contract adjustments with an exact source total", () => {
    const result = parseProjectTotalsRows([
      ["03 30 00 - Cast-in-Place Concrete", "Foundation scope", null, null, 100.005],
      ["06 10 00 - Rough Carpentry", null, null, null, 50.005],
      ["Company Overhead & Margin"],
      ["Company Overhead", null, null, null, 10],
      ["Company Margin", null, null, null, 5],
      ["Contingency", null, null, null, 2],
      ["Project Total:", null, null, null, 167.01],
      ["Adjusted Project Totals", null, null, null, 150],
    ])

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.lines).toHaveLength(5)
    expect(result.displayedTotalCents).toBe(16_701)
    expect(result.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(
      16_701
    )
    expect(result.roundingAdjustmentCents).toBe(-1)
    expect(result.lines.at(-1)).toMatchObject({
      costCode: "99 30 00",
      divisionName: "Contract Adjustments",
      amountCents: 199,
    })
    expect(result.lines.at(-1)?.specifications).toContain(
      "Source rounding reconciliation"
    )
  })

  it("rejects duplicate source cost codes", () => {
    const result = parseProjectTotalsRows([
      ["27 00 00 - Communications", null, null, null, "$1,150.00"],
      ["27 00 00 - Communications", null, null, null, "$1,150.00"],
      ["Project Total:", null, null, null, "$2,300.00"],
    ])

    expect(result).toEqual({
      success: false,
      error:
        "Project Totals contains duplicate cost codes: 27 00 00. Resolve them before import.",
    })
  })

  it("rejects a displayed total that does not reconcile to its lines", () => {
    const result = parseProjectTotalsRows([
      ["03 30 00 - Cast-in-Place Concrete", null, null, null, 100],
      ["Project Total:", null, null, null, 101],
    ])

    expect(result).toEqual({
      success: false,
      error:
        "Project Totals does not reconcile: displayed $101.00 versus line total $100.00.",
    })
  })
})

describe("spreadsheetIdFromUrl", () => {
  it("accepts a Google Sheets URL and rejects unrelated URLs", () => {
    expect(
      spreadsheetIdFromUrl(
        "https://docs.google.com/spreadsheets/d/source-sheet-id/edit#gid=0"
      )
    ).toBe("source-sheet-id")
    expect(spreadsheetIdFromUrl("https://example.com/not-a-sheet")).toBeNull()
  })
})
