import { describe, expect, it } from "vitest"

import { savedViewDefaultValue, savedViewReadSource } from "../rules"

describe("savedViewReadSource", () => {
  it("reads saved_views once it covers every legacy view the reader can see", () => {
    expect(savedViewReadSource(["a", "b"], ["b", "a"])).toBe("consolidated")
    expect(savedViewReadSource([], [])).toBe("consolidated")
  })

  it("stays on the legacy table while any visible view is not backfilled yet", () => {
    // A view created after deploy is in both tables; older ones are only legacy.
    expect(savedViewReadSource(["old", "new"], ["new"])).toBe("legacy")
  })

  it("stays on the legacy table when saved_views cannot be read", () => {
    expect(savedViewReadSource(["a"], null)).toBe("legacy")
    expect(savedViewReadSource([], null)).toBe("legacy")
  })
})

describe("savedViewDefaultValue", () => {
  it("prefers the saved_view_defaults row, inline first, then the named view", () => {
    expect(savedViewDefaultValue({ inlineDefinition: "inline", viewDefinition: "view" }, "legacy")).toBe("inline")
    expect(savedViewDefaultValue({ inlineDefinition: null, viewDefinition: "view" }, "legacy")).toBe("view")
    expect(savedViewDefaultValue({ inlineDefinition: null, viewDefinition: null }, "legacy")).toBeNull()
  })

  it("falls back to the legacy preference when there is no new row", () => {
    expect(savedViewDefaultValue(undefined, "legacy")).toBe("legacy")
    expect(savedViewDefaultValue(null, null)).toBeNull()
  })
})
