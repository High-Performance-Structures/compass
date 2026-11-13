import { describe, expect, it } from "vitest"

import { specificationCurrent, specificationJson, type SelectionSpecification } from "@/lib/selections/decisions"

const published: SelectionSpecification = {
  roomName: "Primary Bath",
  name: "Vanity faucet",
  category: "Plumbing",
  description: null,
  quantity: 2,
  manufacturer: "Example Co",
  model: "F-100",
  colorFinish: "Brushed nickel",
  supplierName: null,
  productUrl: null,
}

describe("specificationCurrent", () => {
  it("keeps an unlocked, published selection current when only its room changes", () => {
    expect(specificationCurrent(specificationJson(published), { ...published, roomName: "Owner's Bath" }, false)).toBe(true)
  })

  it("keeps a locked selection current when only its room changes", () => {
    expect(specificationCurrent(specificationJson(published), { ...published, roomName: "Owner's Bath" }, true)).toBe(true)
  })

  it("goes pending when the product itself changes", () => {
    const json = specificationJson(published)
    expect(specificationCurrent(json, { ...published, name: "Tub faucet" }, false)).toBe(false)
    expect(specificationCurrent(json, { ...published, quantity: 3 }, false)).toBe(false)
    expect(specificationCurrent(json, { ...published, colorFinish: "Matte black", roomName: "Owner's Bath" }, false)).toBe(false)
  })
})
