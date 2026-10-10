import { and, asc, eq, gte, lt, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { projects, projectTravelChargeOverrides, scheduleTasks, travelChargeSettings } from "@/db/schema"
import { applyTravelOverride, type EffectiveTravelCharge } from "@/lib/portfolio-map/travel-overrides"
import { getProjects } from "@/app/actions/projects"
import { getCurrentUser } from "@/lib/auth"
import { isInternalStaffRole } from "@/lib/user-roles"
import { getCloudflareContext } from "@/lib/db"
import { projectDisplayName } from "@/lib/project-display-name"
import { dateKeyInTimeZone } from "@/lib/work-calendar"
import {
  defaultPortfolioPhase,
  isPortfolioMapVisibility,
  portfolioHealth,
  portfolioPhaseFor,
  resolveTown,
  spreadSharedTowns,
  type PortfolioMapJob,
  type PortfolioProjectRule,
} from "@/lib/portfolio-map/model"
import { locateSites, siteLocationWriter, needsSiteLookup, SITE_LOOKUPS_PER_LOAD } from "@/lib/portfolio-map/site-locations"
import {
  DEFAULT_TRAVEL_CHARGE_SETTINGS,
  jobTravelCharge,
  parseTravelChargeSettings,
  type TravelChargeSettings,
} from "@/lib/portfolio-map/travel-zones"

const TIME_ZONE = "America/Denver"

export type PortfolioUnplacedJob = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}

export type PortfolioHiddenJob = PortfolioUnplacedJob & {
  /** The setting that puts the job back: "default" when its status would show it. */
  readonly restoreVisibility: "default" | "shown"
}

/** The job's charge with any per-job adjustments applied (see travel-overrides). */
/** Where the site lookup stands: found, tried and not matched, not tried yet, or no address to try. */
export type SiteLookupState = "found" | "not_found" | "pending" | "no_address"

export type PortfolioJobTravel = EffectiveTravelCharge & {
  readonly siteLookup: SiteLookupState
  /** How the site was placed when not from its own number, e.g. "Near 1062 CR 8952". */
  readonly siteNote: string | null
}

/** Office-only: zone and mountain charges. Never sent to owner or vendor views. */
export type PortfolioTravelData = {
  readonly settings: TravelChargeSettings
  readonly byJobId: Readonly<Record<string, PortfolioJobTravel>>
}

export type PortfolioMapData = {
  readonly jobs: readonly PortfolioMapJob[]
  /** Null for people outside the office staff. */
  readonly travel: PortfolioTravelData | null
  /** Jobs in a mapped phase whose town could not be resolved. */
  readonly unplaced: readonly PortfolioUnplacedJob[]
  /** Jobs someone removed from the map with the per-project override. */
  readonly hidden: readonly PortfolioHiddenJob[]
}

const EMPTY: PortfolioMapData = {
  jobs: [],
  travel: null,
  unplaced: [],
  hidden: [],
}

/**
 * Jobs for the office portfolio map. Visibility follows getProjects(), so the
 * map never shows a job the person cannot already open.
 */
export async function getPortfolioMapData(): Promise<PortfolioMapData> {
  try {
    const user = await getCurrentUser()
    if (!user?.organizationId) return EMPTY
    const visible = await getProjects()
    if (visible.length === 0) return EMPTY

    const { env, ctx } = await getCloudflareContext()
    if (!env?.DB) return EMPTY
    const db = getDb(env.DB)
    const orgId = user.organizationId
    const today = dateKeyInTimeZone(new Date(), TIME_ZONE)

    const [locations, taskStats, upcoming, storedSettings, overrideRows] = await Promise.all([
      db
        .select({
          id: projects.id,
          department: projects.department,
          address: projects.address,
          publicLocationCity: projects.publicLocationCity,
          mapVisibility: projects.portfolioMapVisibility,
          siteLatitude: projects.siteLatitude,
          siteLongitude: projects.siteLongitude,
          siteElevationFt: projects.siteElevationFt,
          siteLocationAddress: projects.siteLocationAddress,
          siteLocationStatus: projects.siteLocationStatus,
          siteLocatedAt: projects.siteLocatedAt,
          siteLocationNote: projects.siteLocationNote,
        })
        .from(projects)
        .where(eq(projects.organizationId, orgId)),
      // Aggregate in SQL rather than loading every task row.
      db
        .select({
          projectId: scheduleTasks.projectId,
          progress: sql<number | null>`avg(${scheduleTasks.percentComplete})`,
          pastDue: sql<number>`sum(case when ${scheduleTasks.endDateCalculated} < ${today} and ${scheduleTasks.percentComplete} < 100 then 1 else 0 end)`,
          stalled: sql<number>`sum(case when ${scheduleTasks.startDate} <= ${today} and ${scheduleTasks.endDateCalculated} >= ${today} and ${scheduleTasks.percentComplete} = 0 then 1 else 0 end)`,
        })
        .from(scheduleTasks)
        .innerJoin(projects, eq(scheduleTasks.projectId, projects.id))
        .where(eq(projects.organizationId, orgId))
        .groupBy(scheduleTasks.projectId),
      db
        .select({
          projectId: scheduleTasks.projectId,
          title: scheduleTasks.title,
          startDate: scheduleTasks.startDate,
        })
        .from(scheduleTasks)
        .innerJoin(projects, eq(scheduleTasks.projectId, projects.id))
        .where(
          and(
            eq(projects.organizationId, orgId),
            gte(scheduleTasks.endDateCalculated, today),
            lt(scheduleTasks.percentComplete, 100),
          ),
        )
        .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder)),
      db
        .select({ settingsJson: travelChargeSettings.settingsJson })
        .from(travelChargeSettings)
        .where(eq(travelChargeSettings.organizationId, orgId))
        .limit(1),
      // Per-job adjustments are optional: if they can't be read, the map
      // still shows every job with the default charges.
      db
        .select()
        .from(projectTravelChargeOverrides)
        .where(eq(projectTravelChargeOverrides.organizationId, orgId))
        .catch((error: unknown) => {
          console.error("Per-job zone charges unavailable", error instanceof Error ? error.message : error)
          return []
        }),
    ])
    const settings = parseStoredSettings(storedSettings[0]?.settingsJson)
    const overrideById = new Map(overrideRows.map((row) => [row.projectId, row]))

    const locationById = new Map(locations.map((row) => [row.id, row]))
    const hidden: PortfolioHiddenJob[] = []
    const phased = visible.flatMap((project) => {
      const location = locationById.get(project.id)
      const stored = location?.mapVisibility ?? "default"
      const rule: PortfolioProjectRule = {
        projectId: project.id,
        projectNumber: project.projectNumber,
        department: location?.department ?? null,
        jobStatusId: project.jobStatusId,
        jobStatusLabel: project.jobStatusLabel,
        visibility: isPortfolioMapVisibility(stored) ? stored : "default",
      }
      if (rule.visibility === "hidden") {
        hidden.push({
          id: project.id,
          name: projectDisplayName(project),
          projectNumber: project.projectNumber,
          restoreVisibility: defaultPortfolioPhase(rule) ? "default" : "shown",
        })
        return []
      }
      const phase = portfolioPhaseFor(rule)
      return phase ? [{ project, phase, visibility: rule.visibility }] : []
    })
    const statsById = new Map(taskStats.map((row) => [row.projectId, row]))
    const nextById = new Map<string, { readonly title: string; readonly startDate: string }>()
    for (const task of upcoming) {
      if (!nextById.has(task.projectId)) nextById.set(task.projectId, task)
    }

    const unplaced: PortfolioUnplacedJob[] = []
    const jobs: PortfolioMapJob[] = phased.map(({ project, phase, visibility }) => {
      const location = locationById.get(project.id)
      const town = resolveTown({
        publicLocationCity: location?.publicLocationCity ?? null,
        address: location?.address ?? null,
        name: project.name,
      })
      if (!town) {
        unplaced.push({ id: project.id, name: projectDisplayName(project), projectNumber: project.projectNumber })
      }
      const stats = statsById.get(project.id)
      const pastDueCount = Number(stats?.pastDue ?? 0)
      const stalledCount = Number(stats?.stalled ?? 0)
      const next = nextById.get(project.id)
      return {
        id: project.id,
        name: projectDisplayName(project),
        projectNumber: project.projectNumber,
        phase,
        statusLabel: project.jobStatusLabel,
        town: town?.town ?? null,
        lon: town?.lon ?? null,
        lat: town?.lat ?? null,
        progress:
          stats?.progress === null || stats?.progress === undefined
            ? null
            : Math.round(Number(stats.progress)),
        pastDueCount,
        stalledCount,
        nextTaskTitle: next?.title ?? null,
        nextTaskStart: next?.startDate ?? null,
        health: portfolioHealth(pastDueCount, stalledCount),
        visibility,
      }
    })
    // Fan out same-town jobs, then put jobs with a located site on the site itself.
    const now = Date.now()
    const showTravel = isInternalStaffRole(user.role)
    const byJobId: Record<string, PortfolioJobTravel> = {}
    const placedJobs = spreadSharedTowns(jobs).map((job) => {
      const location = locationById.get(job.id)
      const site =
        location?.siteLocationStatus === "found" &&
        location.siteLocationAddress === (location.address?.trim() ?? "") &&
        location.siteLatitude !== null &&
        location.siteLongitude !== null
          ? { lat: location.siteLatitude, lon: location.siteLongitude, elevationFt: location.siteElevationFt }
          : null
      const lat = site?.lat ?? job.lat
      const lon = site?.lon ?? job.lon
      const address = location?.address?.trim() ?? ""
      const siteLookup: SiteLookupState = site
        ? "found"
        : address.length === 0
          ? "no_address"
          : location?.siteLocationStatus === "not_found" && location.siteLocationAddress === address
            ? "not_found"
            : "pending"
      if (showTravel && lat !== null && lon !== null) {
        const elevationFt = site?.elevationFt ?? null
        const row = overrideById.get(job.id)
        const charge = applyTravelOverride(
          { ...jobTravelCharge({ lat, lon, elevationFt, approximate: site === null, settings }), elevationFt },
          row
            ? {
                zoneIndex: row.zoneIndex,
                zoneRateCents: row.zoneRateCents,
                siteElevationFt: row.siteElevationFt,
                mountainRateCents: row.mountainRateCents,
                lodging: row.lodging,
                lodgingPerNightCents: row.lodgingPerNightCents,
                perDiemPerDayCents: row.perDiemPerDayCents,
                note: row.note,
              }
            : null,
          settings,
        )
        byJobId[job.id] = { ...charge, siteLookup, siteNote: site ? (location?.siteLocationNote ?? null) : null }
      }
      return site ? { ...job, lat: site.lat, lon: site.lon } : job
    })
    const toLocate = placedJobs
      .flatMap((job) => {
        const location = locationById.get(job.id)
        return location && needsSiteLookup(location, now) ? [location] : []
      })
      .slice(0, SITE_LOOKUPS_PER_LOAD)
    if (toLocate.length > 0) ctx.waitUntil(locateSites(siteLocationWriter(db, orgId), toLocate))
    return { jobs: placedJobs, travel: showTravel ? { settings, byJobId } : null, unplaced, hidden }
  } catch (error) {
    console.error("Portfolio map data failed", error)
    return EMPTY
  }
}

function parseStoredSettings(json: string | undefined): TravelChargeSettings {
  if (!json) return DEFAULT_TRAVEL_CHARGE_SETTINGS
  try {
    return parseTravelChargeSettings(JSON.parse(json))
  } catch {
    return DEFAULT_TRAVEL_CHARGE_SETTINGS
  }
}

export type PortfolioAddableProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly statusLabel: string
}

/**
 * Projects the person can open that are off the map only because of their
 * status or department (not hidden by hand). Loaded on demand by "Add a
 * project to the map" so the dashboard does not carry the full list.
 */
export async function getPortfolioAddableProjects(): Promise<readonly PortfolioAddableProject[]> {
  try {
    const user = await getCurrentUser()
    if (!user?.organizationId) return []
    const visible = await getProjects()
    if (visible.length === 0) return []
    const { env } = await getCloudflareContext()
    if (!env?.DB) return []
    const rows = await getDb(env.DB)
      .select({
        id: projects.id,
        department: projects.department,
        mapVisibility: projects.portfolioMapVisibility,
      })
      .from(projects)
      .where(eq(projects.organizationId, user.organizationId))
    const rowById = new Map(rows.map((row) => [row.id, row]))
    return visible
      .flatMap((project): PortfolioAddableProject[] => {
        const row = rowById.get(project.id)
        const stored = row?.mapVisibility ?? "default"
        const rule: PortfolioProjectRule = {
          projectId: project.id,
          projectNumber: project.projectNumber,
          department: row?.department ?? null,
          jobStatusId: project.jobStatusId,
          jobStatusLabel: project.jobStatusLabel,
          visibility: isPortfolioMapVisibility(stored) ? stored : "default",
        }
        if (rule.visibility !== "default" || portfolioPhaseFor(rule) !== null) return []
        return [{
          id: project.id,
          name: projectDisplayName(project),
          projectNumber: project.projectNumber,
          statusLabel: project.jobStatusLabel,
        }]
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    console.error("Portfolio addable projects failed", error)
    return []
  }
}
