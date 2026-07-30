import { describe, expect, it } from "vitest"

import { requiresSynchronousPrint } from "@/lib/print/ios-print"

describe("requiresSynchronousPrint", () => {
  it("detects iPadOS when Safari identifies the device as a Mac", () => {
    expect(
      requiresSynchronousPrint({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      })
    ).toBe(true)
  })

  it("detects traditional iPad user agents", () => {
    expect(
      requiresSynchronousPrint({
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPad",
        maxTouchPoints: 5,
      })
    ).toBe(true)
  })

  it("keeps desktop browsers on the image-aware print path", () => {
    expect(
      requiresSynchronousPrint({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140",
        platform: "MacIntel",
        maxTouchPoints: 0,
      })
    ).toBe(false)
  })
})
