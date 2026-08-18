import { describe, expect, it } from "vitest"

import { resolveMobilePlatform } from "@/lib/native/platform"

describe("resolveMobilePlatform", () => {
  it("prefers an injected Capacitor platform", () => {
    expect(resolveMobilePlatform("ios", "android", "android")).toBe("ios")
  })

  it("uses the explicit URL marker when Capacitor is unavailable", () => {
    expect(resolveMobilePlatform(undefined, "android", null)).toBe("android")
  })

  it("retains native mode across hosted app navigation", () => {
    expect(resolveMobilePlatform(undefined, null, "ios")).toBe("ios")
  })

  it("does not trust unknown platform markers", () => {
    expect(resolveMobilePlatform(undefined, "windows", "unknown")).toBe("web")
  })
})
