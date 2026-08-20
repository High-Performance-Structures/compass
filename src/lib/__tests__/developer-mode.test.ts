import { describe, expect, it } from "vitest"

import { developerModeFromCookie } from "@/lib/developer-mode"

describe("developer mode preference", () => {
  it("requires both an enabled preference and developer permission", () => {
    expect(developerModeFromCookie("enabled", true)).toBe(true)
    expect(developerModeFromCookie("enabled", false)).toBe(false)
  })

  it("defaults to worker mode for missing or disabled preferences", () => {
    expect(developerModeFromCookie(undefined, true)).toBe(false)
    expect(developerModeFromCookie("disabled", true)).toBe(false)
    expect(developerModeFromCookie("unexpected", true)).toBe(false)
  })
})
