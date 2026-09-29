import { describe, expect, it } from "vitest"

import { rfqScopeCodingErrors } from "@/lib/rfqs/cost-codes"

const sageCodes = new Map([["03 30 00", "03"], ["09 90 00", "09"]])
const divisions = new Set(["03", "09"])

describe("RFQ Sage scope coding", () => {
  it("accepts matching Sage divisions and cost codes with optional uncoded rows", () => {
    expect(rfqScopeCodingErrors(
      [
        { phaseCode: "03", costCode: "03 30 00" },
        { phaseCode: "09", costCode: null },
        { phaseCode: null, costCode: null },
      ],
      sageCodes,
      divisions
    )).toEqual([])
  })

  it("rejects unknown codes, unknown divisions, and mismatched pairs", () => {
    expect(rfqScopeCodingErrors(
      [
        { phaseCode: "03", costCode: "CUSTOM" },
        { phaseCode: "X", costCode: null },
        { phaseCode: "09", costCode: "03 30 00" },
      ],
      sageCodes,
      divisions
    )).toEqual([
      "Scope row 1: choose an active Sage cost code.",
      "Scope row 2: choose an active Sage division.",
      "Scope row 3: division must match cost code 03 30 00.",
    ])
  })

  it("preserves unchanged legacy coding but rejects copying it to another row", () => {
    expect(rfqScopeCodingErrors(
      [
        { phaseCode: "OLD", costCode: "LEGACY" },
        { phaseCode: "OLD", costCode: "LEGACY" },
      ],
      sageCodes,
      divisions,
      [{ phaseCode: "OLD", costCode: "LEGACY" }]
    )).toEqual(["Scope row 2: choose an active Sage division."])
  })
})
