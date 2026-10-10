import placesData from "./colorado-places.json"
import zipsData from "./colorado-zips.json"
import { resolvedProjectDepartment } from "@/lib/project-branding"
import { PROJECT_JOB_STATUS_DEFINITIONS, projectJobStatusBucket } from "@/lib/project-profile"
import type { PortfolioMapVisibility } from "@/lib/portfolio-map/visibility"

export const PORTFOLIO_PHASES = [
  { id: "intake", label: "Intake", short: "INT" },
  { id: "design", label: "Design", short: "DES" },
  { id: "estimating", label: "Estimating", short: "EST" },
  { id: "negotiation", label: "Negotiation", short: "NEG" },
  { id: "permitting", label: "Permitting", short: "PER" },
  { id: "construction", label: "Under construction", short: "BLD" },
  { id: "closeout", label: "Closeout", short: "CLO" },
] as const

export type PortfolioPhaseId = (typeof PORTFOLIO_PHASES)[number]["id"]
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
}

/**
 * Job statuses grouped into the map's pipeline phases. Closeout covers punch
 * list and warranty work. Statuses not listed are not shown: complete,
 * closed, refused, inactive, internal, and the material
 * order statuses (ordered, partial order, price sheet sent, shipping TBD,
 * awaiting payment).
 */
const PHASE_BY_JOB_STATUS: Readonly<Record<string, PortfolioPhaseId>> = {
  // Intake: first contact and new-client info, before any design or pricing.
  intake: "intake",
  new_client_info_sent: "intake",
  budget_estimating: "estimating",
  budget_estimate_sent: "estimating",
  estimating: "estimating",
  estimate_sent: "estimating",
  awaiting_response: "estimating",
  follow_up: "estimating",
  takeoff: "estimating",
  design_proposal: "design",
  design_proposal_sent: "design",
  design_proposal_signed: "design",
  in_design: "design",
  engineering: "design",
  value_engineering: "design",
  // Negotiation: reviewing, drafting, sending or revising the contract, until
  // it is awarded and funded.
  contract_docs: "negotiation",
  contract_docs_sent: "negotiation",
  contract_docs_signed: "negotiation",
  contract: "negotiation",
  awarded: "negotiation",
  awaiting_funding: "negotiation",
  permitting: "permitting",
  // Permit in hand, waiting to start.
  awaiting_groundbreaking: "permitting",
  bracing_out: "construction",
  under_construction: "construction",
  current: "construction",
  punchlist: "closeout",
  under_warranty: "closeout",
}

/**
 * The built-in statuses of each phase, in workflow order, for moving a job to
 * another status from the map. Custom statuses are changed on the job page.
 */
export function portfolioPhaseStatuses(phase: PortfolioPhaseId): readonly string[] {
  return Object.entries(PHASE_BY_JOB_STATUS).flatMap(([status, statusPhase]) => (statusPhase === phase ? [status] : []))
}

/**
 * The map covers HPS and Open Range (construction and design) projects;
 * Nu-Tech jobs are left off. Projects without a recognizable department stay.
 */
export function isMappedDepartment(project: {
  readonly department: string | null
  readonly projectId: string
  readonly projectNumber: string | null
}): boolean {
  return resolvedProjectDepartment(project) !== "N"
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
export function defaultPortfolioPhase(rule: PortfolioProjectRule): PortfolioPhaseId | null {
  const phase = phaseForJobStatus(rule.jobStatusId, rule.jobStatusLabel)
  return phase && isMappedDepartment(rule) ? phase : null
}

/**
 * Where a job appears on the map, if at all. The per-project override wins:
 * "hidden" removes it; "shown" keeps it even when its status or department is
 * normally excluded, using closeout for warranty/complete jobs and
 * pre-construction otherwise when the status has no phase.
 */
export function portfolioPhaseFor(rule: PortfolioProjectRule): PortfolioPhaseId | null {
  if (rule.visibility === "hidden") return null
  if (rule.visibility === "default") return defaultPortfolioPhase(rule)
  const phase = phaseForJobStatus(rule.jobStatusId, rule.jobStatusLabel)
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

/** Phase for a job status; custom statuses match a standard status by label. */
export function phaseForJobStatus(
  jobStatusId: string | null,
  jobStatusLabel: string | null,
): PortfolioPhaseId | null {
  if (jobStatusId) {
    const direct = PHASE_BY_JOB_STATUS[jobStatusId]
    if (direct) return direct
  }
  if (jobStatusLabel) {
    const standardId = STANDARD_ID_BY_LABEL.get(normalizeLabel(jobStatusLabel))
    if (standardId) return PHASE_BY_JOB_STATUS[standardId] ?? null
  }
  return null
}

type PlaceEntry = readonly [number, number, number]

function isPlaceEntry(value: unknown): value is PlaceEntry {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === "number")
  )
}

const PLACES: ReadonlyMap<string, PlaceEntry> = new Map(
  Object.entries(placesData).flatMap(([name, entry]): [string, PlaceEntry][] =>
    isPlaceEntry(entry) ? [[name, entry]] : [],
  ),
)

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

/** Census ZIP code areas in Colorado: center point and the nearest town's name. */
const ZIPS: ReadonlyMap<string, ZipEntry> = new Map(
  Object.entries(zipsData).flatMap(([zip, entry]): [string, ZipEntry][] =>
    isZipEntry(entry) ? [[zip, entry]] : [],
  ),
)

const COLORADO_ZIP = /\b(8[01]\d{3})(?:-\d{4})?\b/

const ZIP_CODE = /\b\d{5}(?:-\d{4})?\b/g
// Only a trailing state or country is dropped, so towns like "Colorado
// Springs" and "Colorado City" keep their full names.
const TRAILING_STATE = /(?:\s+(?:co|colo|colorado|usa|us))+$/

function placeKey(candidate: string): string {
  return normalizeLabel(candidate.replace(ZIP_CODE, " "))
    .replace(/^(?:town|city) of\s+/, "")
    .replace(TRAILING_STATE, "")
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
export function resolveTown(input: {
  readonly publicLocationCity: string | null
  readonly address: string | null
  readonly name: string
}): ResolvedTown | null {
  const found = (key: string): ResolvedTown | null => {
    const place = key ? PLACES.get(key) : undefined
    return place ? { town: titleCase(key), lon: place[0], lat: place[1] } : null
  }
  if (input.publicLocationCity) {
    const town = found(placeKey(input.publicLocationCity))
    if (town) return town
  }
  if (input.address) {
    const parts = input.address.split(/[,\n]/).reverse()
    for (const part of parts) {
      const town = found(placeKey(part))
      if (town) return town
    }
    // Addresses written without commas ("12 Twinkle Rd Guffey CO 80820"):
    // try the last one to three words before the state and ZIP.
    const words = placeKey(input.address).split(" ")
    for (let size = 3; size >= 1; size -= 1) {
      if (words.length <= size) continue
      const town = found(words.slice(-size).join(" "))
      if (town) return town
    }
    // Then the ZIP code, labeled with its nearest town.
    const zip = COLORADO_ZIP.exec(input.address)?.[1]
    const zipEntry = zip ? ZIPS.get(zip) : undefined
    if (zipEntry) return { town: zipEntry[2], lon: zipEntry[0], lat: zipEntry[1] }
  }
  const nameParts = input.name.split(/\s+[-–—]\s+/)
  const nameTown = nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined
  return nameTown ? found(placeKey(nameTown)) : null
}

const TOWN_RADIUS_KM = 2.5
// Cities, towns and villages; scattered localities don't mark a town.
const TOWN_MAX_RANK = 2

/**
 * The town whose center is nearest a point and within about 2.5 km of it,
 * or null in the countryside. Used to tell when a street match is really in
 * another town ("Main Street" in Fairplay for an Alma address).
 */
export function townAt(latitude: number, longitude: number): string | null {
  const kmPerLon = 111.32 * Math.cos((latitude * Math.PI) / 180)
  let best: { readonly name: string; readonly km: number } | null = null
  for (const [name, [lon, lat, rank]] of PLACES) {
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
