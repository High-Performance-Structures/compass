import placesData from "./colorado-places.json"
import { PROJECT_JOB_STATUS_DEFINITIONS } from "@/lib/project-profile"

export const PORTFOLIO_PHASES = [
  { id: "estimating", label: "Estimating", short: "EST" },
  { id: "design", label: "Design", short: "DES" },
  { id: "permitting", label: "Permitting", short: "PER" },
  { id: "precon", label: "Pre-construction", short: "PRE" },
  { id: "construction", label: "Under construction", short: "BLD" },
  { id: "closeout", label: "Closeout", short: "CLO" },
] as const

export type PortfolioPhaseId = (typeof PORTFOLIO_PHASES)[number]["id"]
export type PortfolioHealth = "ok" | "risk" | "late"

export type PortfolioMapJob = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly phase: PortfolioPhaseId
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
}

/**
 * Job statuses grouped into the map's pipeline phases. Statuses not listed
 * (warranty, complete, closed, refused, inactive) are not shown on the map.
 */
const PHASE_BY_JOB_STATUS: Readonly<Record<string, PortfolioPhaseId>> = {
  intake: "estimating",
  new_client_info_sent: "estimating",
  budget_estimating: "estimating",
  budget_estimate_sent: "estimating",
  estimating: "estimating",
  estimate_sent: "estimating",
  takeoff: "estimating",
  price_sheet_sent: "estimating",
  design_proposal: "design",
  design_proposal_sent: "design",
  design_proposal_signed: "design",
  in_design: "design",
  engineering: "design",
  value_engineering: "design",
  permitting: "permitting",
  contract_docs: "precon",
  contract_docs_sent: "precon",
  contract_docs_signed: "precon",
  contract: "precon",
  awarded: "precon",
  awaiting_funding: "precon",
  awaiting_groundbreaking: "precon",
  ordered: "precon",
  partial_order: "precon",
  shipping_tbd: "precon",
  awaiting_payment: "precon",
  bracing_out: "construction",
  under_construction: "construction",
  current: "construction",
  punchlist: "closeout",
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

const STATE_OR_ZIP = /\b(co|colorado|usa|us)\b|\b\d{5}(?:-\d{4})?\b/gi

function placeKey(candidate: string): string {
  return normalizeLabel(
    candidate.replace(STATE_OR_ZIP, " ").replace(/^\s*(town|city) of\s+/i, ""),
  )
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
 * Town-level location without geocoding: the public city field, then each
 * part of the address (last first), then the "… - Town" suffix of the name.
 */
export function resolveTown(input: {
  readonly publicLocationCity: string | null
  readonly address: string | null
  readonly name: string
}): ResolvedTown | null {
  const candidates: string[] = []
  if (input.publicLocationCity) candidates.push(input.publicLocationCity)
  if (input.address) candidates.push(...input.address.split(/[,\n]/).reverse())
  const nameParts = input.name.split(/\s+[-–—]\s+/)
  const nameTown = nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined
  if (nameTown) candidates.push(nameTown)
  for (const candidate of candidates) {
    const key = placeKey(candidate)
    if (!key) continue
    const place = PLACES.get(key)
    if (place) return { town: titleCase(key), lon: place[0], lat: place[1] }
  }
  return null
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
export function spreadSharedTowns(
  jobs: readonly PortfolioMapJob[],
): readonly PortfolioMapJob[] {
  const byTown = new Map<string, PortfolioMapJob[]>()
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
