import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { projects } from "@/db/schema"
import { fetchElevationFeet, geocodeProjectAddress } from "@/lib/geo/site-lookup"

/** Few per dashboard load: the public geocoders ask for light, sequential use. */
export const SITE_LOOKUPS_PER_LOAD = 5
const RETRY_NOT_FOUND_MS = 7 * 24 * 60 * 60 * 1000
// A site is stamped before its lookup; for this long, later loads move on to
// other sites instead of retrying it (a slow lookup may have been cut off).
const ATTEMPT_COOLDOWN_MS = 10 * 60 * 1000
// Background work after a response gets about 30 seconds. Start no new
// lookup after LOOKUP_START_BUDGET_MS, and stop waiting at LOOKUP_DEADLINE_MS.
export const LOOKUP_START_BUDGET_MS = 15_000
export const LOOKUP_DEADLINE_MS = 25_000

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
  if (row.siteLocationAddress !== address) return true
  const lastTried = row.siteLocatedAt ? Date.parse(row.siteLocatedAt) : Number.NaN
  const triedAgo = Number.isFinite(lastTried) ? now - lastTried : Number.POSITIVE_INFINITY
  if (row.siteLocationStatus === null || (row.siteLocationStatus === "found" && row.siteElevationFt === null)) {
    return triedAgo > ATTEMPT_COOLDOWN_MS
  }
  if (row.siteLocationStatus === "found") return false
  return triedAgo > RETRY_NOT_FOUND_MS
}

type LookupOutcome =
  | { readonly status: "unavailable" }
  | {
      readonly status: "done"
      readonly values: {
        readonly siteLatitude: number | null
        readonly siteLongitude: number | null
        readonly siteElevationFt: number | null
        readonly siteLocationStatus: "found" | "not_found"
        readonly siteLocationNote: string | null
      }
    }

async function lookUp(address: string): Promise<LookupOutcome> {
  const result = await geocodeProjectAddress(address)
  if (result.status === "unavailable") return { status: "unavailable" }
  const found = result.status === "found" ? result.coordinates : null
  const elevation = found ? await fetchElevationFeet(found.latitude, found.longitude) : null
  return {
    status: "done",
    values: {
      siteLatitude: found?.latitude ?? null,
      siteLongitude: found?.longitude ?? null,
      siteElevationFt: elevation,
      siteLocationStatus: found ? "found" : "not_found",
      siteLocationNote: found && found.precision !== "address" ? found.label : null,
    },
  }
}

function timeout(ms: number): Promise<{ readonly status: "timeout" }> {
  return new Promise((resolve) => setTimeout(() => resolve({ status: "timeout" }), Math.max(0, ms)))
}

export type SiteLocationWrite = {
  readonly siteLocationAddress?: string
  readonly siteLocationStatus?: "found" | "not_found" | null
  readonly siteLatitude?: number | null
  readonly siteLongitude?: number | null
  readonly siteElevationFt?: number | null
  readonly siteLocationNote?: string | null
  readonly siteLocatedAt?: string
}

export type SiteLocationWriter = (projectId: string, values: SiteLocationWrite) => Promise<void>

/** Saves site lookups on the organization's projects. */
export function siteLocationWriter(db: ReturnType<typeof getDb>, organizationId: string): SiteLocationWriter {
  return async (projectId, values) => {
    await db
      .update(projects)
      .set(values)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
  }
}

/**
 * Locate sites one at a time and cache the result on the project. Runs after
 * the response (waitUntil), within its time limit. Each site is stamped
 * first, so a lookup that gets cut off doesn't hold up the others; a busy
 * map service or a cut-off lookup leaves the site to be tried again later.
 */
export async function locateSites(
  write: SiteLocationWriter,
  rows: readonly SiteLocationRow[],
  clock: () => number = Date.now,
): Promise<void> {
  const started = clock()
  for (const row of rows) {
    if (clock() - started > LOOKUP_START_BUDGET_MS) break
    const address = row.address?.trim() ?? ""
    if (!address) continue
    try {
      // An edited address drops the old location; otherwise only the attempt time changes.
      const stamp = new Date(clock()).toISOString()
      await write(
        row.id,
        row.siteLocationAddress === address
          ? { siteLocatedAt: stamp }
          : {
              siteLocationAddress: address,
              siteLocationStatus: null,
              siteLatitude: null,
              siteLongitude: null,
              siteElevationFt: null,
              siteLocationNote: null,
              siteLocatedAt: stamp,
            },
      )
      const outcome = await Promise.race([lookUp(address), timeout(LOOKUP_DEADLINE_MS - (clock() - started))])
      if (outcome.status === "timeout") break
      if (outcome.status === "unavailable") continue
      await write(row.id, { ...outcome.values, siteLocationAddress: address, siteLocatedAt: new Date(clock()).toISOString() })
    } catch (error) {
      console.error("Site lookup failed", row.id, error)
    }
  }
}
