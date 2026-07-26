import { describe, expect, it } from "vitest"

import { sameOriginNavigationHref } from "@/lib/navigation/internal-link"

const ORIGIN = "https://compass.openrangeconstruction.ltd"

describe("sameOriginNavigationHref", () => {
  it("normalizes same-origin absolute Compass links", () => {
    expect(
      sameOriginNavigationHref(
        `${ORIGIN}/dashboard/projects/loeffler/rfis?status=all#rfi-1`,
        ORIGIN
      )
    ).toBe("/dashboard/projects/loeffler/rfis?status=all#rfi-1")
  })

  it("normalizes relative Compass links", () => {
    expect(
      sameOriginNavigationHref(
        "/dashboard/projects/loomis/owner-updates",
        ORIGIN
      )
    ).toBe("/dashboard/projects/loomis/owner-updates")
  })

  it("leaves external and unsafe links to normal browser handling", () => {
    expect(
      sameOriginNavigationHref("https://example.com/dashboard", ORIGIN)
    ).toBeNull()
    expect(
      sameOriginNavigationHref("javascript:alert('no')", ORIGIN)
    ).toBeNull()
  })
})
