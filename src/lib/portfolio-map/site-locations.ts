import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { projects } from "@/db/schema"
import { COLORADO_BOUNDS, fetchElevationFeet, geocodeProjectAddress } from "@/lib/geo/site-lookup"

/** Few per dashboard load: the public geocoders ask for light, sequential use. */
export const SITE_LOOKUPS_PER_LOAD = 5
const RETRY_NOT_FOUND_MS = 7 * 24 * 60 * 60 * 1000

export type SiteLocationRow = {
  readonly id: string
  readonly address: string | null
  readonly siteLocationAddress: string | null
  readonly siteLocationStatus: string | null
  readonly siteElevationFt: number | null
  readonly siteLocatedAt: string | null
}

/** True when the site has an address that has not been located (or was edited since). */
export function needsSiteLookup(row: SiteLocationRow, now: number): boolean {
  const address = row.address?.trim() ?? ""
  if (!address) return false
  if (row.siteLocationAddress !== address || row.siteLocationStatus === null) return true
  if (row.siteLocationStatus === "found") return row.siteElevationFt === null
  const lastTried = row.siteLocatedAt ? Date.parse(row.siteLocatedAt) : Number.NaN
  return !Number.isFinite(lastTried) || now - lastTried > RETRY_NOT_FOUND_MS
}

/**
 * Locate sites one at a time and cache the result on the project. Runs after
 * the response (waitUntil); failures leave the row to be tried again later.
 */
export async function locateSites(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  rows: readonly SiteLocationRow[],
): Promise<void> {
  for (const row of rows) {
    const address = row.address?.trim() ?? ""
    if (!address) continue
    try {
      const found = await geocodeProjectAddress(address, COLORADO_BOUNDS)
      const elevation = found ? await fetchElevationFeet(found.latitude, found.longitude) : null
      await db
        .update(projects)
        .set({
          siteLatitude: found?.latitude ?? null,
          siteLongitude: found?.longitude ?? null,
          siteElevationFt: elevation,
          siteLocationAddress: address,
          siteLocationStatus: found ? "found" : "not_found",
          siteLocatedAt: new Date().toISOString(),
        })
        .where(and(eq(projects.id, row.id), eq(projects.organizationId, organizationId)))
    } catch (error) {
      console.error("Site lookup failed", row.id, error)
    }
  }
}
