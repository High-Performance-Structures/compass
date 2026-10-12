import { beforeEach, describe, expect, it, vi } from "vitest"
import type { GeocodeResult } from "@/lib/geo/site-lookup"

const geocode = vi.fn<(address: string) => Promise<GeocodeResult>>()
const elevation = vi.fn<(latitude: number, longitude: number) => Promise<number | null>>()

vi.mock("@/lib/geo/site-lookup", () => ({
  geocodeProjectAddress: (address: string) => geocode(address),
  fetchElevationFeet: (latitude: number, longitude: number) => elevation(latitude, longitude),
}))

const { LOOKUP_START_BUDGET_MS, locateSites, needsSiteLookup } = await import("../site-locations")
type SiteLocationRow = Parameters<typeof needsSiteLookup>[0]

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
    expect(needsSiteLookup(row({ siteLocationStatus: null, siteLocationAddress: null, siteLocatedAt: null }), NOW)).toBe(true)
    expect(needsSiteLookup(row({ address: "9 Other Rd, Divide, CO" }), NOW)).toBe(true)
  })

  it("keeps a found site, unless its elevation is missing", () => {
    expect(needsSiteLookup(row({}), NOW)).toBe(false)
    expect(needsSiteLookup(row({ siteElevationFt: null }), NOW)).toBe(true)
  })

  it("lets other sites go first for ten minutes after an attempt", () => {
    const pending = { siteLocationStatus: null, siteElevationFt: null }
    expect(needsSiteLookup(row({ ...pending, siteLocatedAt: "2026-10-08T11:55:00Z" }), NOW)).toBe(false)
    expect(needsSiteLookup(row({ ...pending, siteLocatedAt: "2026-10-08T11:45:00Z" }), NOW)).toBe(true)
    expect(needsSiteLookup(row({ siteElevationFt: null, siteLocatedAt: "2026-10-08T11:55:00Z" }), NOW)).toBe(false)
  })

  it("retries an unmatched address after a week", () => {
    const notFound = { siteLocationStatus: "not_found", siteElevationFt: null }
    expect(needsSiteLookup(row({ ...notFound, siteLocatedAt: "2026-10-05T00:00:00Z" }), NOW)).toBe(false)
    expect(needsSiteLookup(row({ ...notFound, siteLocatedAt: "2026-09-20T00:00:00Z" }), NOW)).toBe(true)
  })
})

type Write = Readonly<Record<string, unknown>>

function recorder(writes: Write[]): (projectId: string, values: Write) => Promise<void> {
  return async (_projectId, values) => {
    writes.push(values)
  }
}

describe("locateSites", () => {
  beforeEach(() => {
    geocode.mockReset()
    elevation.mockReset()
  })

  const pending = (id: string, address: string): SiteLocationRow =>
    row({ id, address, siteLocationAddress: null, siteLocationStatus: null, siteElevationFt: null, siteLocatedAt: null })

  it("stamps the attempt, then saves the site with its note", async () => {
    geocode.mockResolvedValue({
      status: "found",
      coordinates: { latitude: 40, longitude: -105.9, label: "Near 10 CR 5", query: "x", precision: "nearby" },
    })
    elevation.mockResolvedValue(8100)
    const writes: Write[] = []
    await locateSites(recorder(writes), [pending("a", "12 CR 5, Granby")], () => NOW)
    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({ siteLocationAddress: "12 CR 5, Granby", siteLocationStatus: null })
    expect(writes[1]).toMatchObject({
      siteLatitude: 40,
      siteElevationFt: 8100,
      siteLocationStatus: "found",
      siteLocationNote: "Near 10 CR 5",
    })
  })

  it("leaves a site stamped but unresolved when the map service is busy", async () => {
    geocode.mockResolvedValue({ status: "unavailable" })
    const writes: Write[] = []
    await locateSites(recorder(writes), [pending("a", "12 CR 5, Granby")], () => NOW)
    expect(writes).toHaveLength(1)
  })

  it("starts no new lookup once the time budget is spent", async () => {
    geocode.mockResolvedValue({ status: "not_found" })
    let now = NOW
    const clock = (): number => now
    const writes: Write[] = []
    geocode.mockImplementation(async () => {
      now += LOOKUP_START_BUDGET_MS + 1
      return { status: "not_found" }
    })
    await locateSites(recorder(writes), [pending("a", "1 A St, Alma"), pending("b", "2 B St, Alma")], clock)
    expect(geocode).toHaveBeenCalledTimes(1)
    expect(writes.at(-1)).toMatchObject({ siteLocationStatus: "not_found" })
  })
})
