import { describe, expect, it } from "vitest"
import { splitAddress } from "@/lib/projects/address-parts"

describe("splitAddress", () => {
  it("splits number, street and the rest", () => {
    expect(splitAddress("1503 Cornucopia, Leadville, CO 80461")).toEqual({
      streetNumber: "1503",
      streetName: "Cornucopia",
      cityStateZip: "Leadville, CO 80461",
    })
    expect(splitAddress("703 South Hancock, COS,CO 80903")).toEqual({
      streetNumber: "703",
      streetName: "South Hancock",
      cityStateZip: "COS,CO 80903",
    })
  })

  it("keeps addresses without a number or city as they are", () => {
    expect(splitAddress("Escalante")).toEqual({ streetNumber: null, streetName: "Escalante", cityStateZip: null })
    expect(splitAddress("2328 Meadowlark")).toEqual({ streetNumber: "2328", streetName: "Meadowlark", cityStateZip: null })
    expect(splitAddress(null)).toEqual({ streetNumber: null, streetName: null, cityStateZip: null })
  })
})
