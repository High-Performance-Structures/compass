import { describe, expect, it } from "vitest"
import { FEATURE_SETTINGS, linkedJobSettingsSchema } from "@/lib/feature-settings/registry"

describe("linked job shortcuts", () => {
  it("ships valid defaults, including pour help or stacking from Nu-Tech to HPS", () => {
    const defaults = FEATURE_SETTINGS["linked-jobs"].defaults
    expect(linkedJobSettingsSchema.safeParse(defaults).success).toBe(true)
    expect(defaults.shortcuts).toContainEqual(expect.objectContaining({ label: "Pour help or stacking", fromDepartment: "N", toDepartment: "H" }))
  })

  it("rejects an unknown target department", () => {
    const result = linkedJobSettingsSchema.safeParse({
      shortcuts: [{ id: "x", label: "X", fromDepartment: "*", toDepartment: "hps", workItems: [] }],
    })
    expect(result.success).toBe(false)
  })
})
