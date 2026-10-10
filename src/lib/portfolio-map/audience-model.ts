import {
  PORTFOLIO_PHASES,
  phaseForJobStatus,
  resolveTown,
  spreadSharedTowns,
  type PortfolioMapJob,
  type PortfolioPhaseId,
} from "@/lib/portfolio-map/model"
import { projectDisplayName } from "@/lib/project-display-name"

export type AudienceJobRow = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly address: string | null
  readonly publicLocationCity: string | null
  readonly jobStatusId: string | null
  readonly statusLabel: string
}

/**
 * Map jobs for an owner or sub/vendor. Only jobs the viewer already has are
 * passed in; the phase comes from job status alone (their involvement
 * matters, not the office department filter), and no office-only signals are
 * carried: no progress, health, past-due counts, or next office task.
 */
export function audienceMapJobs(rows: readonly AudienceJobRow[]): readonly PortfolioMapJob[] {
  const jobs = rows.flatMap((row): PortfolioMapJob[] => {
    const phase = phaseForJobStatus(row.jobStatusId, row.statusLabel)
    if (!phase) return []
    const town = resolveTown({
      publicLocationCity: row.publicLocationCity,
      address: row.address,
      name: row.name,
    })
    return [{
      id: row.id,
      name: projectDisplayName(row),
      projectNumber: row.projectNumber,
      phase,
      jobStatusId: row.jobStatusId,
      statusLabel: row.statusLabel,
      town: town?.town ?? null,
      lon: town?.lon ?? null,
      lat: town?.lat ?? null,
      progress: null,
      pastDueCount: 0,
      stalledCount: 0,
      nextTaskTitle: null,
      nextTaskStart: null,
      health: "ok",
      visibility: "default",
      followUp: null,
    }]
  })
  return spreadSharedTowns(jobs)
}

export type VendorJobScopeItem = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
}

export type VendorJobScope = {
  readonly upcoming: readonly VendorJobScopeItem[]
  readonly commitmentCount: number
}

/**
 * The vendor's own scope on a job, taken from the vendor dashboard's data so
 * the panel shows nothing that dashboard would not.
 */
export function vendorJobScope(
  data: {
    readonly scheduleItems: readonly {
      readonly id: string
      readonly title: string
      readonly startDate: string
      readonly endDate: string
      readonly percentComplete: number
    }[]
    readonly operations: readonly unknown[]
  },
  today: string,
): VendorJobScope {
  return {
    upcoming: data.scheduleItems
      .filter((item) => item.endDate >= today && item.percentComplete < 100)
      .toSorted((left, right) => left.startDate.localeCompare(right.startDate))
      .slice(0, 3)
      .map(({ id, title, startDate, endDate }) => ({ id, title, startDate, endDate })),
    commitmentCount: data.operations.length,
  }
}

/** Phase names written for homeowners. */
export const OWNER_PHASE_LABEL: Readonly<Record<PortfolioPhaseId, string>> = {
  intake: "Getting started",
  estimating: "Pricing",
  design: "Design",
  permitting: "Permits",
  negotiation: "Contract",
  construction: "Under construction",
  closeout: "Finishing up",
}

export type OwnerPhaseStep = {
  readonly id: PortfolioPhaseId
  readonly label: string
  readonly state: "done" | "current" | "upcoming"
}

export function ownerPhaseSteps(current: PortfolioPhaseId): readonly OwnerPhaseStep[] {
  const index = PORTFOLIO_PHASES.findIndex((phase) => phase.id === current)
  return PORTFOLIO_PHASES.map((phase, position) => ({
    id: phase.id,
    label: OWNER_PHASE_LABEL[phase.id],
    state: position < index ? "done" : position === index ? "current" : "upcoming",
  }))
}

/**
 * Share of scheduled work complete across the items the owner can see,
 * weighted by workdays so a one-day inspection does not count like a
 * month of framing. Null when nothing is scheduled for the owner.
 */
export function ownerScheduleProgress(
  items: readonly { readonly percentComplete: number; readonly workdays: number | null }[],
): number | null {
  let weight = 0
  let done = 0
  for (const item of items) {
    const days = Math.max(1, item.workdays ?? 1)
    weight += days
    done += days * Math.min(100, Math.max(0, item.percentComplete))
  }
  return weight === 0 ? null : Math.round(done / weight)
}
