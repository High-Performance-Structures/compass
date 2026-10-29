import placesData from "./colorado-places.json"
import zipsData from "./colorado-zips.json"
import { resolvedProjectDepartment } from "@/lib/project-branding"
import { PROJECT_JOB_STATUS_DEFINITIONS, projectJobStatusBucket } from "@/lib/project-profile"
import type { PortfolioMapVisibility } from "@/lib/portfolio-map/visibility"
import type { ProjectFollowUpSignal } from "@/lib/project-follow-up"

import {
  departmentView,
  DEFAULT_PHASE_BY_JOB_STATUS,
  DEFAULT_PORTFOLIO_MAP_RULES,
  PORTFOLIO_PHASES,
  type PortfolioMapRules,
  type PortfolioPhaseId,
} from "@/lib/portfolio-map/phases"

export { PORTFOLIO_PHASES, DEFAULT_PORTFOLIO_MAP_RULES, type PortfolioMapRules, type PortfolioPhaseId }
export type PortfolioHealth = "ok" | "risk" | "late"
export { isPortfolioMapVisibility, type PortfolioMapVisibility } from "@/lib/portfolio-map/visibility"

export type PortfolioMapJob = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly phase: PortfolioPhaseId
  /** The job's status id, so a status can be changed from the map. */
  readonly jobStatusId: string | null
  readonly statusLabel: string
  readonly town: string | null
  readonly lon: number | null
  readonly lat: number | null
  /** Average schedule completion (0-100), or null when the job has no schedule. */
  readonly progress: number | null
  readonly pastDueCount: number
  readonly stalledCount: number
  readonly nextTaskTitle: string | null
  readonly nextTaskStart: string | null
  readonly health: PortfolioHealth
  readonly visibility: PortfolioMapVisibility
  /** Client follow-up aging; null when the status isn't followed up or the viewer isn't office staff. */
  readonly followUp: ProjectFollowUpSignal | null
  /** The pinned working plan-set document, or null when none is set; drives the pipeline plan-set shortcut. */
  readonly planSetDocumentId: string | null
}

/**
 * The flag over a map marker: the worse of schedule health (construction)
 * and client follow-up aging. Red is past due or overdue; amber is at risk
 * or follow-up due.
 */
export function portfolioMarkerAlert(job: PortfolioMapJob): "late" | "risk" | null {
  if (job.health === "late" || job.followUp?.level === "overdue") return "late"
  if (job.health === "risk" || job.followUp?.level === "due") return "risk"
  return null
}

/**
 * The built-in statuses of each phase (with the company's changes), in
 * workflow order, for moving a job to another status from the map. Custom
 * statuses are changed on the job page.
 */
export function portfolioPhaseStatuses(phase: PortfolioPhaseId, rules: PortfolioMapRules = DEFAULT_PORTFOLIO_MAP_RULES): readonly string[] {
  // Built-in order first, then any other standard status the company mapped.
  const ids = new Set([...Object.keys(DEFAULT_PHASE_BY_JOB_STATUS), ...PROJECT_JOB_STATUS_DEFINITIONS.map((status) => status.id)])
  return [...ids].filter((id) => statusPhase(id, rules) === phase)
}

/**
 * Whether a department's jobs appear with the projects: HPS, Open Range and
 * Design do, Nu-Tech has its own sales view, unless the company changed it.
 * Projects without a recognizable department stay.
 */
export function isMappedDepartment(
  project: {
    readonly department: string | null
    readonly projectId: string
    readonly projectNumber: string | null
  },
  rules: PortfolioMapRules = DEFAULT_PORTFOLIO_MAP_RULES,
): boolean {
  return departmentView(resolvedProjectDepartment(project), rules) === "projects"
}

export type PortfolioProjectRule = {
  readonly projectId: string
  readonly projectNumber: string | null
  readonly department: string | null
  readonly jobStatusId: string | null
  readonly jobStatusLabel: string | null
  readonly visibility: PortfolioMapVisibility
}

/** Phase the job would have by its status and department alone. */
export function defaultPortfolioPhase(rule: PortfolioProjectRule, rules: PortfolioMapRules = DEFAULT_PORTFOLIO_MAP_RULES): PortfolioPhaseId | null {
  const phase = phaseForJobStatus(rule.jobStatusId, rule.jobStatusLabel, rules)
  return phase && isMappedDepartment(rule, rules) ? phase : null
}

/**
 * Where a job appears on the map, if at all. The per-project override wins:
 * "hidden" removes it; "shown" keeps it even when its status or department is
 * normally excluded, using closeout for warranty/complete jobs and
 * pre-construction otherwise when the status has no phase.
 */
export function portfolioPhaseFor(rule: PortfolioProjectRule, rules: PortfolioMapRules = DEFAULT_PORTFOLIO_MAP_RULES): PortfolioPhaseId | null {
  if (rule.visibility === "hidden") return null
  if (rule.visibility === "default") return defaultPortfolioPhase(rule, rules)
  const phase = phaseForJobStatus(rule.jobStatusId, rule.jobStatusLabel, rules)
  if (phase) return phase
  const bucket = projectJobStatusBucket({
    jobStatusId: rule.jobStatusId ?? "",
    jobStatusLabel: rule.jobStatusLabel ?? "",
  })
  return bucket === "warranty" || bucket === "complete" ? "closeout" : "estimating"
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

const STANDARD_ID_BY_LABEL: ReadonlyMap<string, string> = new Map(
  PROJECT_JOB_STATUS_DEFINITIONS.map((status) => [normalizeLabel(status.label), status.id]),
)

/** A status's phase: the company's setting, else the built-in one; undefined when neither names it. */
function statusPhase(statusId: string, rules: PortfolioMapRules): PortfolioPhaseId | null | undefined {
  const configured = rules.statusPhases[statusId]
  if (configured) return configured === "off" ? null : configured
  return DEFAULT_PHASE_BY_JOB_STATUS[statusId]
}

/** Phase for a job status; custom statuses match a standard status by label. */
export function phaseForJobStatus(
  jobStatusId: string | null,
  jobStatusLabel: string | null,
  rules: PortfolioMapRules = DEFAULT_PORTFOLIO_MAP_RULES,
): PortfolioPhaseId | null {
  if (jobStatusId) {
    const direct = statusPhase(jobStatusId, rules)
    if (direct !== undefined) return direct
  }
  if (jobStatusLabel) {
    const standardId = STANDARD_ID_BY_LABEL.get(normalizeLabel(jobStatusLabel))
    if (standardId) return statusPhase(standardId, rules) ?? null
  }
  return null
}

/** Town center [lon, lat, rank]; rank 0 is a major city, 3 a scattered locality. */
type PlaceEntry = readonly [number, number, number]

function isPlaceEntry(value: unknown): value is PlaceEntry {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === "number")
  )
}

function placeMap(value: unknown): ReadonlyMap<string, PlaceEntry> {
  if (typeof value !== "object" || value === null) return new Map()
  return new Map(
    Object.entries(value).flatMap(([name, entry]): [string, PlaceEntry][] => (isPlaceEntry(entry) ? [[name, entry]] : [])),
  )
}

type ZipEntry = readonly [number, number, string]

function isZipEntry(value: unknown): value is ZipEntry {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    typeof value[2] === "string"
  )
}

function zipMap(value: unknown): ReadonlyMap<string, ZipEntry> {
  if (typeof value !== "object" || value === null) return new Map()
  return new Map(Object.entries(value).flatMap(([zip, entry]): [string, ZipEntry][] => (isZipEntry(entry) ? [[zip, entry]] : [])))
}

/** One state's towns and Census ZIP code areas (center point and the nearest town's name). */
export type PlaceIndex = {
  readonly places: ReadonlyMap<string, PlaceEntry>
  readonly zips: ReadonlyMap<string, ZipEntry>
  /** Trailing words naming the state ("co", "colorado"), dropped from town names. */
  readonly trailingState: RegExp
}

function trailingStatePattern(words: readonly string[]): RegExp {
  // Only a trailing state or country is dropped, so towns like "Colorado
  // Springs" and "Colorado City" keep their full names.
  return new RegExp(`(?:\\s+(?:${[...words, "usa", "us"].map((word) => normalizeLabel(word)).join("|")}))+$`)
}

/** A state's place file (public/maps/places), validated instead of trusted. */
export function parsePlaceIndex(value: unknown, stateWords: readonly string[]): PlaceIndex {
  const record = typeof value === "object" && value !== null ? value : {}
  return {
    places: placeMap(Reflect.get(record, "places")),
    zips: zipMap(Reflect.get(record, "zips")),
    trailingState: trailingStatePattern(stateWords),
  }
}

/** Colorado's towns and ZIP codes ship with the app; other states load on demand. */
export const COLORADO_PLACES: PlaceIndex = {
  places: placeMap(placesData),
  zips: zipMap(zipsData),
  trailingState: trailingStatePattern(["co", "colo", "colorado"]),
}

const ZIP_CODE = /\b\d{5}(?:-\d{4})?\b/g

function placeKey(candidate: string, index: PlaceIndex): string {
  return normalizeLabel(candidate.replace(ZIP_CODE, " "))
    .replace(/^(?:town|city) of\s+/, "")
    .replace(index.trailingState, "")
    .trim()
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

export type ResolvedTown = {
  readonly town: string
  readonly lon: number
  readonly lat: number
}

/**
 * Town-level location without geocoding: the public city field, then the town
 * in the site address, then its ZIP code, then the "… - Town" suffix of the
 * project name.
 */
export function resolveTown(
  input: {
    readonly publicLocationCity: string | null
    readonly address: string | null
    readonly name: string
  },
  index: PlaceIndex = COLORADO_PLACES,
): ResolvedTown | null {
  const found = (key: string): ResolvedTown | null => {
    const place = key ? index.places.get(key) : undefined
    return place ? { town: titleCase(key), lon: place[0], lat: place[1] } : null
  }
  if (input.publicLocationCity) {
    const town = found(placeKey(input.publicLocationCity, index))
    if (town) return town
  }
  if (input.address) {
    const parts = input.address.split(/[,\n]/).reverse()
    for (const part of parts) {
      const town = found(placeKey(part, index))
      if (town) return town
    }
    // Addresses written without commas ("12 Twinkle Rd Guffey CO 80820"):
    // try the last one to three words before the state and ZIP.
    const words = placeKey(input.address, index).split(" ")
    for (let size = 3; size >= 1; size -= 1) {
      if (words.length <= size) continue
      const town = found(words.slice(-size).join(" "))
      if (town) return town
    }
    // Then the ZIP code (the last one in the state's list), labeled with its nearest town.
    const zips = [...input.address.matchAll(ZIP_CODE)].map((match) => match[0].slice(0, 5)).reverse()
    const zipEntry = zips.map((zip) => index.zips.get(zip)).find((entry) => entry !== undefined)
    if (zipEntry) return { town: zipEntry[2], lon: zipEntry[0], lat: zipEntry[1] }
  }
  const nameParts = input.name.split(/\s+[-–—]\s+/)
  const nameTown = nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined
  return nameTown ? found(placeKey(nameTown, index)) : null
}

const TOWN_RADIUS_KM = 2.5
// Cities, towns and villages; scattered localities don't mark a town.
const TOWN_MAX_RANK = 2

/**
 * The town whose center is nearest a point and within about 2.5 km of it,
 * or null in the countryside. Used to tell when a street match is really in
 * another town ("Main Street" in Fairplay for an Alma address).
 */
export function townAt(latitude: number, longitude: number, index: PlaceIndex = COLORADO_PLACES): string | null {
  const kmPerLon = 111.32 * Math.cos((latitude * Math.PI) / 180)
  let best: { readonly name: string; readonly km: number } | null = null
  for (const [name, [lon, lat, rank]] of index.places) {
    if (rank > TOWN_MAX_RANK) continue
    const km = Math.hypot((lat - latitude) * 110.57, (lon - longitude) * kmPerLon)
    if (km <= TOWN_RADIUS_KM && (!best || km < best.km)) best = { name, km }
  }
  return best ? titleCase(best.name) : null
}

export function portfolioHealth(pastDueCount: number, stalledCount: number): PortfolioHealth {
  if (pastDueCount > 0) return "late"
  if (stalledCount > 0) return "risk"
  return "ok"
}

/**
 * Jobs in the same town would stack on one point; fan them out on a small
 * ring (about 3 km) in a stable order.
 */
export function spreadSharedTowns<
  T extends { readonly id: string; readonly town: string | null; readonly lon: number | null; readonly lat: number | null },
>(jobs: readonly T[]): readonly T[] {
  const byTown = new Map<string, T[]>()
  for (const job of jobs) {
    if (job.lon === null || job.lat === null || job.town === null) continue
    const group = byTown.get(job.town) ?? []
    group.push(job)
    byTown.set(job.town, group)
  }
  const offsets = new Map<string, { readonly lon: number; readonly lat: number }>()
  for (const group of byTown.values()) {
    if (group.length < 2) continue
    const ordered = [...group].sort((a, b) => a.id.localeCompare(b.id))
    ordered.forEach((job, index) => {
      const angle = (index / ordered.length) * Math.PI * 2
      offsets.set(job.id, { lon: Math.cos(angle) * 0.035, lat: Math.sin(angle) * 0.026 })
    })
  }
  return jobs.map((job) => {
    const offset = offsets.get(job.id)
    if (!offset || job.lon === null || job.lat === null) return job
    return { ...job, lon: job.lon + offset.lon, lat: job.lat + offset.lat }
  })
}
