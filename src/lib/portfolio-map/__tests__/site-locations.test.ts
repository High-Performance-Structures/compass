import { describe, expect, it } from "vitest"
import { needsSiteLookup, type SiteLocationRow } from "../site-locations"

const NOW = Date.parse("2026-10-08T12:00:00Z")

function row(overrides: Partial<SiteLocationRow>): SiteLocationRow {
  return {
    id: "p1",
    address: "123 Main St, Woodland Park, CO 80863",
    siteLocationAddress: "123 Main St, Woodland Park, CO 80863",
    siteLocationStatus: "found",
    siteElevationFt: 8465,
    siteLocatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  }
}

describe("needsSiteLookup", () => {
  it("skips projects without an address", () => {
    expect(needsSiteLookup(row({ address: "  " }), NOW)).toBe(false)
  })

  it("looks up new and edited addresses", () => {
    expect(needsSiteLookup(row({ siteLocationStatus: null, siteLocationAddress: null }), NOW)).toBe(true)
    expect(needsSiteLookup(row({ address: "9 Other Rd, Divide, CO" }), NOW)).toBe(true)
  })

  it("keeps a found site, unless its elevation is missing", () => {
    expect(needsSiteLookup(row({}), NOW)).toBe(false)
    expect(needsSiteLookup(row({ siteElevationFt: null }), NOW)).toBe(true)
  })

  it("retries an unmatched address after a week", () => {
    const notFound = { siteLocationStatus: "not_found", siteElevationFt: null }
    expect(needsSiteLookup(row({ ...notFound, siteLocatedAt: "2026-10-05T00:00:00Z" }), NOW)).toBe(false)
    expect(needsSiteLookup(row({ ...notFound, siteLocatedAt: "2026-09-20T00:00:00Z" }), NOW)).toBe(true)
  })
})
