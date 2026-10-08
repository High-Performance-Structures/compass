import {
  phaseForJobStatus,
  resolveTown,
  spreadSharedTowns,
  type PortfolioMapJob,
} from "@/lib/portfolio-map/model"
import { projectDisplayName } from "@/lib/project-display-name"

export type VendorJobRow = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly address: string | null
  readonly publicLocationCity: string | null
  readonly jobStatusId: string | null
  readonly statusLabel: string
}

/**
 * Map jobs for a sub/vendor. Only the vendor's assigned jobs are passed in;
 * the phase comes from job status alone (assignment matters, not the office
 * department filter), and no office-only signals are carried: no progress,
 * health, past-due counts, or next office task.
 */
export function vendorMapJobs(rows: readonly VendorJobRow[]): readonly PortfolioMapJob[] {
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
