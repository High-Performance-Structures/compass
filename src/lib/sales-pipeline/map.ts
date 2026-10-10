import type { PortfolioMapJob } from "@/lib/portfolio-map/model"
import type { SalesPipelineJob } from "@/lib/sales-pipeline/load"
import { SALES_STAGES, SALES_STAGE_COLOR_TOKEN } from "@/lib/sales-pipeline/stages"

/** The sales stages as the map key, in pipeline order. */
export const SALES_MAP_KEY_ENTRIES: readonly { readonly id: string; readonly label: string; readonly colorToken: string }[] =
  SALES_STAGES.map((stage) => ({ id: stage.id, label: stage.label, colorToken: SALES_STAGE_COLOR_TOKEN[stage.id] }))

/**
 * Sales jobs as map markers. They have no schedule, so every marker is a flat
 * slab colored by its sales stage (see salesMarkerColorTokens).
 */
export function salesMapJobs(jobs: readonly SalesPipelineJob[]): readonly PortfolioMapJob[] {
  return jobs.map((job) => ({
    id: job.id,
    name: job.name,
    projectNumber: job.projectNumber,
    phase: "estimating",
    jobStatusId: job.jobStatusId,
    statusLabel: job.statusLabel,
    town: job.town,
    lon: job.lon,
    lat: job.lat,
    progress: null,
    pastDueCount: 0,
    stalledCount: 0,
    nextTaskTitle: null,
    nextTaskStart: null,
    health: "ok",
    visibility: "default",
  }))
}

export function salesMarkerColorTokens(jobs: readonly SalesPipelineJob[]): ReadonlyMap<string, string> {
  return new Map(jobs.map((job) => [job.id, SALES_STAGE_COLOR_TOKEN[job.stage]]))
}
