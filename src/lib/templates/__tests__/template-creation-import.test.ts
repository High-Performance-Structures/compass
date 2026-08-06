import { describe, expect, it } from "vitest"

import {
  parseTemplateChoiceOptions,
  resolveTemplateSchedulePhase
} from "@/lib/templates/template-creation-import"

describe("template creation imports", () => {
  it("uses the captured construction phase when Compass recognizes it", () => {
    expect(
      resolveTemplateSchedulePhase({
        capturedPhase: "Insulation & Drywall",
        tradeCategory: "Drywall"
      })
    ).toBe("drywall")
  })

  it("falls back to the template trade when Buildertrend left the phase unassigned", () => {
    expect(
      resolveTemplateSchedulePhase({
        capturedPhase: "UNASSIGNED",
        tradeCategory: "Drywall"
      })
    ).toBe("drywall")
  })

  it("reads the preserved finish choices without accepting malformed values", () => {
    expect(
      parseTemplateChoiceOptions(JSON.stringify(["Hand Trowel", "Knockdown", "Orange Peel"]))
    ).toEqual(["Hand Trowel", "Knockdown", "Orange Peel"])
    expect(parseTemplateChoiceOptions('{"choice":"Hand Trowel"}')).toEqual([])
    expect(parseTemplateChoiceOptions("not-json")).toEqual([])
  })
})
