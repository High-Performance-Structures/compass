import { describe, expect, it } from "vitest"
import { isFieldAppUrl, resolveDashboardAppUrl } from "./app-url"

const LIVE_ORIGIN = "https://compass.openrangeconstruction.ltd"

describe("resolveDashboardAppUrl", () => {
  it("preserves an approved dashboard path, query, and fragment", () => {
    expect(
      resolveDashboardAppUrl(
        `${LIVE_ORIGIN}/dashboard/conversations/123?tab=thread#latest`,
        LIVE_ORIGIN,
      ),
    ).toBe(
      `${LIVE_ORIGIN}/dashboard/conversations/123?tab=thread#latest`,
    )
  })

  it("rejects lookalike origins", () => {
    expect(
      resolveDashboardAppUrl(
        "https://compass.openrangeconstruction.ltd.attacker.example/dashboard/projects",
        LIVE_ORIGIN,
      ),
    ).toBeUndefined()
  })

  it("rejects non-dashboard and custom-scheme URLs", () => {
    expect(
      resolveDashboardAppUrl(`${LIVE_ORIGIN}/login`, LIVE_ORIGIN),
    ).toBeUndefined()
    expect(
      resolveDashboardAppUrl(
        "compass://auth/callback?code=abc",
        LIVE_ORIGIN,
      ),
    ).toBeUndefined()
  })
})

describe("isFieldAppUrl", () => {
  it("accepts only the dedicated Field return deep link", () => {
    expect(isFieldAppUrl("compass://field")).toBe(true)
    expect(isFieldAppUrl("compass://field/projects")).toBe(true)
    expect(isFieldAppUrl("compass://auth/callback")).toBe(false)
    expect(isFieldAppUrl("https://compass.openrangeconstruction.ltd/dashboard/field")).toBe(false)
    expect(isFieldAppUrl("not a url")).toBe(false)
  })
})
