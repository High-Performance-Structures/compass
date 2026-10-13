import { describe, expect, it } from "vitest"
import { estimateModeFor, nextEstimateNumber } from "@/lib/estimates/estimate-modes"

describe("estimate modes", () => {
  it("defaults Nu-Tech to several estimates and other departments to one", () => {
    expect(estimateModeFor("N", {})).toBe("multiple")
    expect(estimateModeFor("H", {})).toBe("single")
    expect(estimateModeFor(null, {})).toBe("single")
  })

  it("uses the company's setting over the built-in mode", () => {
    expect(estimateModeFor("N", { N: "single" })).toBe("single")
    expect(estimateModeFor("D", { D: "multiple" })).toBe("multiple")
  })
})

describe("nextEstimateNumber", () => {
  it("takes the next two-digit suffix after those already used", () => {
    expect(nextEstimateNumber("N-1003-00", ["N-1003-00-00"])).toBe("N-1003-00-01")
    expect(nextEstimateNumber("N-997-00", ["N-997-00-00", "N-997-00-02"])).toBe("N-997-00-03")
    expect(nextEstimateNumber("N-1-0", [])).toBe("N-1-0-01")
  })

  it("ignores numbers from other projects or with other shapes", () => {
    expect(nextEstimateNumber("N-10-0", ["N-10-0-1-05", "N-100-0-07", "N-10-0-04"])).toBe("N-10-0-05")
  })
})
