import { describe, expect, it } from "vitest"
import { nuTechEstimateLineDescription } from "@/lib/nutech/estimate-wording"

describe("nuTechEstimateLineDescription", () => {
  it("counts blocks and their bundles", () => {
    expect(nuTechEstimateLineDescription({ quantity: 24, unit: "each", name: "Straight", sku: "FOX-S800", packageLabel: "12" })).toBe(
      "24 Straight (FOX-S800), 2 bundles of 12",
    )
    expect(nuTechEstimateLineDescription({ quantity: 12, unit: "each", name: "90° Corner", sku: "FOX-EC890", packageLabel: "12" })).toBe(
      "12 90° Corner (FOX-EC890), 1 bundle of 12",
    )
  })

  it("leaves out bundles when they don't divide evenly or the package isn't a count", () => {
    expect(nuTechEstimateLineDescription({ quantity: 7, unit: "each", name: "Straight", sku: "FOX-S800", packageLabel: "12" })).toBe("7 Straight (FOX-S800)")
    expect(nuTechEstimateLineDescription({ quantity: 20, unit: "each", name: "Web Box", sku: "FOX-WB", packageLabel: "10/bag" })).toBe("20 Web Box (FOX-WB)")
  })

  it("pluralizes boxes and bags", () => {
    expect(nuTechEstimateLineDescription({ quantity: 1, unit: "box", name: "Horizontal/Vertical Clips", sku: "FOX-HVCLIPS", packageLabel: "230/box" })).toBe(
      "1 box of Horizontal/Vertical Clips (FOX-HVCLIPS)",
    )
    expect(nuTechEstimateLineDescription({ quantity: 3, unit: "box", name: "Clips", sku: "C", packageLabel: "230/box" })).toBe("3 boxes of Clips (C)")
    expect(nuTechEstimateLineDescription({ quantity: 2, unit: "bag", name: "Ties", sku: "T", packageLabel: "50/bag" })).toBe("2 bags of Ties (T)")
  })
})
