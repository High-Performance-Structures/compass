import { describe, expect, it } from "vitest"

import { normalizeSageRecordId, sameSageRecordId, withNormalizedSageRecordIds } from "@/lib/sage/record-id"

describe("Sage record ids", () => {
  const upper = "A1B2C3D4-0000-4000-8000-0000000000AA"

  it("folds GUID case only", () => {
    expect(normalizeSageRecordId(upper)).toBe(upper.toLowerCase())
    expect(normalizeSageRecordId("SC-1")).toBe("SC-1")
    expect(normalizeSageRecordId(` ${upper}`)).toBe(` ${upper}`)
    expect(normalizeSageRecordId(null)).toBeNull()
  })

  it("matches the same GUID in either case and nothing else", () => {
    expect(sameSageRecordId(upper, upper.toLowerCase())).toBe(true)
    expect(sameSageRecordId(null, null)).toBe(true)
    expect(sameSageRecordId(upper, null)).toBe(false)
    expect(sameSageRecordId(upper, "a1b2c3d4-0000-4000-8000-0000000000ab")).toBe(false)
    // Non-GUID ids are compared exactly.
    expect(sameSageRecordId("SC-1", "sc-1")).toBe(false)
  })

  it("normalizes both ids of a writer snapshot", () => {
    expect(withNormalizedSageRecordIds({ sageRecordId: upper, parentSageRecordId: upper, revision: "r" }))
      .toEqual({ sageRecordId: upper.toLowerCase(), parentSageRecordId: upper.toLowerCase(), revision: "r" })
  })
})
