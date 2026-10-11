import { describe, expect, it } from "vitest"
import { FEATURE_SETTINGS, canEditFeatureSettings, parseFeatureSettings } from "@/lib/feature-settings/registry"

describe("feature settings", () => {
  const defaults = FEATURE_SETTINGS["message-desk"].defaults

  it("falls back to defaults when nothing or bad data is stored", () => {
    expect(parseFeatureSettings("message-desk", null)).toEqual(defaults)
    expect(parseFeatureSettings("message-desk", "not json")).toEqual(defaults)
    expect(parseFeatureSettings("message-desk", JSON.stringify({ agingDays: 9, staleDays: 3 }))).toEqual(defaults)
  })

  it("merges stored values over defaults", () => {
    expect(parseFeatureSettings("message-desk", JSON.stringify({ staleDays: 7 }))).toEqual({ ...defaults, staleDays: 7 })
  })

  it("requires stale to be longer than aging", () => {
    expect(FEATURE_SETTINGS["message-desk"].schema.safeParse({ ...defaults, agingDays: 5, staleDays: 5 }).success).toBe(false)
  })

  it("lets only admins edit", () => {
    expect(canEditFeatureSettings("admin")).toBe(true)
    expect(canEditFeatureSettings("project_manager")).toBe(false)
  })
})
