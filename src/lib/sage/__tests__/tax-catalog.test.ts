import { describe, expect, it } from "vitest"

import { parseSageTaxCatalog } from "@/lib/sage/tax-catalog"

function catalog(): unknown {
  return {
    capturedAt: "2026-08-25T18:00:00.000Z",
    complete: true,
    taxDistricts: [
      {
        sourceRecordId: "70206",
        code: "70206",
        name: "07-0206 Boulder County Combined",
        ratePercent: 5.185,
      },
      {
        sourceRecordId: "40017",
        code: "40017",
        name: "04-0017 Colorado Springs Combined",
        ratePercent: 8.2,
      },
    ],
  }
}

describe("Sage tax catalog snapshots", () => {
  it("normalizes exact Sage rate precision and stable numeric ordering", () => {
    const result = parseSageTaxCatalog(catalog())

    expect(result).toEqual({
      success: true,
      data: {
        capturedAt: "2026-08-25T18:00:00.000Z",
        taxDistricts: [
          {
            sourceRecordId: "40017",
            code: "40017",
            name: "04-0017 Colorado Springs Combined",
            rateBasisPoints: 820,
          },
          {
            sourceRecordId: "70206",
            code: "70206",
            name: "07-0206 Boulder County Combined",
            rateBasisPoints: 518.5,
          },
        ],
      },
    })
  })

  it("rejects partial snapshots so missing rows cannot be deactivated", () => {
    const input = catalog()
    if (typeof input !== "object" || input === null) throw new Error("bad test")
    Reflect.set(input, "complete", false)

    expect(parseSageTaxCatalog(input)).toEqual({
      success: false,
      error: "Invalid Sage tax catalog snapshot.",
    })
  })

  it("rejects duplicate source records or codes", () => {
    const input = catalog()
    if (typeof input !== "object" || input === null) throw new Error("bad test")
    const districts = Reflect.get(input, "taxDistricts")
    if (!Array.isArray(districts)) throw new Error("bad test")
    districts.push({
      sourceRecordId: "duplicate",
      code: "40017",
      name: "Duplicate",
      ratePercent: 1,
    })

    expect(parseSageTaxCatalog(input)).toEqual({
      success: false,
      error: "Sage tax catalog contains duplicate identifiers.",
    })
  })
})
