import { describe, expect, it } from "vitest"
import { addressState, COLORADO_BOUNDS, confirmsAddress, geocodePlan } from "@/lib/geo/site-lookup"

describe("addressState", () => {
  it("reads a state in its own part, before a ZIP, or ending the town part", () => {
    expect(addressState("1900 County Rd 8952, Granby, CO 80446")).toBe("CO")
    expect(addressState("12 Twinkle Rd Guffey CO 80820")).toBe("CO")
    expect(addressState("12 Main St, Alma CO")).toBe("CO")
    expect(addressState("12 Main St, Alma, Colorado")).toBe("CO")
    expect(addressState("12 Main St, Alma, Colo.")).toBe("CO")
    expect(addressState("400 Pine St, Cheyenne, WY 82001")).toBe("WY")
    expect(addressState("400 Pine St, Santa Fe, New Mexico")).toBe("NM")
    expect(addressState("400 Pine St, Moab, UT, USA")).toBe("UT")
  })

  it("does not read street words or town names as a state", () => {
    expect(addressState("123 CR 5")).toBeNull()
    expect(addressState("4410 CR 5, Woodland Park")).toBeNull()
    expect(addressState("123 Main St, Colorado Springs")).toBeNull()
    expect(addressState("123 Main St, Colorado City 81019")).toBeNull()
    expect(addressState("Lot 4, 22 Elm CT")).toBeNull()
    expect(addressState("22 Elm Ct, Divide")).toBeNull()
    expect(addressState("Alma")).toBeNull()
    expect(addressState("")).toBeNull()
  })
})

describe("geocodePlan", () => {
  it("assumes Colorado when no state is named", () => {
    expect(geocodePlan("4410 CR 5, Woodland Park")).toEqual({
      queries: ["4410 CR 5, Woodland Park, CO", "4410 CR 5, Woodland Park"],
      bounds: COLORADO_BOUNDS,
    })
    expect(geocodePlan("12 Main St, Alma 80420").queries[0]).toBe("12 Main St, Alma, CO 80420")
  })

  it("keeps Colorado addresses as written and limits matches to Colorado", () => {
    expect(geocodePlan("1900 County Rd 8952, Granby, CO 80446")).toEqual({
      queries: ["1900 County Rd 8952, Granby, CO 80446"],
      bounds: COLORADO_BOUNDS,
    })
  })

  it("looks up another named state as written, without the Colorado limit", () => {
    expect(geocodePlan("400 Pine St, Cheyenne, WY 82001")).toEqual({
      queries: ["400 Pine St, Cheyenne, WY 82001"],
      bounds: null,
    })
  })

  it("skips a blank address", () => {
    expect(geocodePlan("  ")).toEqual({ queries: [], bounds: null })
  })
})

describe("confirmsAddress", () => {
  const target = { houseNumber: 1777, street: "Ten Mile Creek Rd" }

  it("accepts a numbered match on the same street", () => {
    expect(confirmsAddress(target, { street: "TEN MILE CREEK ROAD", hasNumber: true })).toBe(true)
  })

  it("rejects a different street, a street without the number, or just the town", () => {
    expect(confirmsAddress(target, { street: "TEN MILE DR", hasNumber: true })).toBe(false)
    expect(confirmsAddress(target, { street: "Ten Mile Creek Road", hasNumber: false })).toBe(false)
    expect(confirmsAddress(target, { street: null, hasNumber: false })).toBe(false)
  })

  it("accepts anything for an address without a house number", () => {
    expect(confirmsAddress(null, { street: null, hasNumber: false })).toBe(true)
  })
})
