import { describe, expect, it } from "vitest"

import {
  inferMobileBrowserPlatform,
  resolveMobilePlatform,
} from "@/lib/native/platform"

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

  it("falls back to the mobile browser platform when launch state is lost", () => {
    expect(resolveMobilePlatform(undefined, null, null, "ios")).toBe("ios")
  })

  it("does not trust unknown platform markers", () => {
    expect(resolveMobilePlatform(undefined, "windows", "unknown")).toBe("web")
  })
})

describe("inferMobileBrowserPlatform", () => {
  it("recognizes iPhone Safari", () => {
    expect(
      inferMobileBrowserPlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("ios")
  })

  it("recognizes Android browsers", () => {
    expect(
      inferMobileBrowserPlatform(
        "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
      ),
    ).toBe("android")
  })

  it("recognizes iPadOS desktop-style Safari", () => {
    expect(
      inferMobileBrowserPlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15",
        "MacIntel",
        5,
      ),
    ).toBe("ios")
  })

  it("keeps desktop browsers in web mode", () => {
    expect(
      inferMobileBrowserPlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
        "MacIntel",
        0,
      ),
    ).toBe("web")
  })
})
