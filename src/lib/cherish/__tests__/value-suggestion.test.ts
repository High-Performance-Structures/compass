import { describe, expect, it } from "vitest"

import { suggestCherishValue } from "@/lib/cherish/value-suggestion"

describe("suggestCherishValue", () => {
  it("suggests nothing before the person writes", () => {
    expect(suggestCherishValue("")).toBeNull()
    expect(suggestCherishValue("  ")).toBeNull()
  })

  it("suggests nothing when no value fits", () => {
    expect(suggestCherishValue("Thanks for Tuesday.")).toBeNull()
  })

  it.each([
    ["The whole crew pitched in together to finish the deck.", "Camaraderie"],
    ["He was respectful with the neighbors and kept his word.", "Honor"],
    ["Beautiful craftsmanship and attention to detail on the trim.", "Excellence"],
    ["She showed up early every day and we could count on her.", "Reliability"],
    ["He owned up to the mistake and was honest with the owner about it.", "Integrity"],
    ["Went the extra mile for the homeowner after hours.", "Servitude"],
    ["Gave credit to the team and asked for help when he needed it.", "Humility"],
  ])("suggests the fitting value for %s", (message, value) => {
    expect(suggestCherishValue(message)).toBe(value)
  })

  it("weights a value named outright over related words", () => {
    expect(suggestCherishValue("Real integrity: the crew stayed late together.")).toBe("Integrity")
  })

  it("matches whole words only", () => {
    expect(suggestCherishValue("That was a funny clientele meeting")).toBeNull()
  })

  it("breaks ties in CHERISH order", () => {
    expect(suggestCherishValue("Great teamwork and on time.")).toBe("Camaraderie")
  })
})
