import { describe, expect, it } from "vitest"

import { nuTechOrderBundles, nuTechTruckload, nuTechTruckloadLabel, type NuTechTruckloadItem } from "@/lib/nutech/truckload"

function item(overrides: Partial<NuTechTruckloadItem>): NuTechTruckloadItem {
  return {
    manufacturerSku: "FOX-S800",
    category: "block",
    quantity: 192,
    priceUnit: "each",
    packageQuantity: 12,
    bundlesPerTruckload: 44,
    ...overrides,
  }
}

describe("nuTechOrderBundles", () => {
  it("turns pieces into whole bundles", () => {
    expect(nuTechOrderBundles(item({ quantity: 192 }))).toBe(16)
    expect(nuTechOrderBundles(item({ quantity: 193 }))).toBe(17)
  })

  it("keeps package-priced quantities as they are", () => {
    expect(nuTechOrderBundles(item({ priceUnit: "box", quantity: 3, packageQuantity: 50 }))).toBe(3)
  })
})

describe("nuTechTruckload", () => {
  it("matches the old Truckload Calculator sheet", () => {
    // The sheet's example: 16 of 44 S800, 13 of 60 EC890, 9 of 44 TT800 = 78.5%.
    const truck = nuTechTruckload([
      item({ manufacturerSku: "FOX-S800", quantity: 192 }),
      item({ manufacturerSku: "FOX-EC890", quantity: 78, packageQuantity: 6, bundlesPerTruckload: 60 }),
      item({ manufacturerSku: "FOX-TT800", quantity: 108 }),
    ])
    expect(truck?.fraction).toBeCloseTo(0.7848, 3)
    expect(truck?.lines.map((line) => line.bundles)).toEqual([16, 13, 9])
    expect(truck?.missingSkus).toEqual([])
  })

  it("lists blocks with no truckload size and skips accessories", () => {
    const truck = nuTechTruckload([
      item({}),
      item({ manufacturerSku: "FOX-C845", bundlesPerTruckload: null }),
      item({ manufacturerSku: "HV-CLIP", category: "accessory", priceUnit: "box", bundlesPerTruckload: null }),
    ])
    expect(truck?.missingSkus).toEqual(["FOX-C845"])
    expect(truck?.lines).toHaveLength(1)
  })

  it("is null when nothing has a truckload size", () => {
    expect(nuTechTruckload([item({ bundlesPerTruckload: null })])).toBeNull()
    expect(nuTechTruckload([])).toBeNull()
  })
})

describe("nuTechTruckloadLabel", () => {
  it("reads as a percent up to one truck, then as trucks", () => {
    expect(nuTechTruckloadLabel(0.8125)).toBe("About 81% of a full truckload")
    expect(nuTechTruckloadLabel(0.001)).toBe("About 1% of a full truckload")
    expect(nuTechTruckloadLabel(1.36)).toBe("About 1.4 truckloads")
  })
})
