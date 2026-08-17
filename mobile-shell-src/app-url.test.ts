import { describe, expect, it } from "vitest"
import { resolveDashboardAppUrl } from "./app-url"

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
