import type { ProjectDepartment } from "@/lib/project-branding"

/**
 * Sales pipeline for material-sales departments (Nu-Tech): one column per
 * stage, each stage a group of job statuses. Moving a job sets one of the
 * stage's statuses, so the pipeline and the job's status never disagree.
 */
export const SALES_STAGES = [
  { id: "intake", label: "Intake", statuses: ["intake", "new_client_info_sent"] },
  { id: "pricing", label: "Pricing", statuses: ["price_sheet_sent", "budget_estimating", "budget_estimate_sent"] },
  { id: "estimating", label: "Estimating", statuses: ["estimating", "takeoff", "design_proposal"] },
  { id: "estimate_sent", label: "Estimate sent", statuses: ["estimate_sent"] },
  { id: "following_up", label: "Following up", statuses: ["awaiting_response", "follow_up"] },
  { id: "awaiting_payment", label: "Awaiting payment", statuses: ["awaiting_payment"] },
  { id: "ordered", label: "Ordered", statuses: ["ordered", "partial_order", "shipping_tbd"] },
  { id: "bracing_out", label: "Bracing out", statuses: ["bracing_out"] },
] as const

export type SalesStageId = (typeof SALES_STAGES)[number]["id"]

/**
 * Stage colors come from the theme, like the portfolio phases, and are eight
 * distinct hues so the map key reads at a glance. Red marks money owed.
 */
export const SALES_STAGE_COLOR_TOKEN: Readonly<Record<SalesStageId, string>> = {
  intake: "--muted-foreground",
  pricing: "--chart-3",
  estimating: "--info",
  estimate_sent: "--chart-5",
  following_up: "--warning",
  awaiting_payment: "--destructive",
  ordered: "--success",
  bracing_out: "--chart-4",
}

/** Departments that sell materials rather than build, with their pipeline's title. */
export const SALES_PIPELINE_DEPARTMENTS: Readonly<Partial<Record<ProjectDepartment, string>>> = {
  N: "Nu-Tech Sales",
}

const STAGE_BY_STATUS: ReadonlyMap<string, SalesStageId> = new Map(
  SALES_STAGES.flatMap((stage) => stage.statuses.map((status): [string, SalesStageId] => [status, stage.id])),
)

/** The stage for a job status, or null when the status isn't a sales stage (closed, or a construction status). */
export function salesStageForJobStatus(jobStatusId: string): SalesStageId | null {
  return STAGE_BY_STATUS.get(jobStatusId) ?? null
}

export function salesStageColor(stage: SalesStageId): string {
  return `var(${SALES_STAGE_COLOR_TOKEN[stage]})`
}

export const DELIVERY_METHODS = ["delivery", "pickup"] as const
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number]

export function isDeliveryMethod(value: unknown): value is DeliveryMethod {
  return value === "delivery" || value === "pickup"
}
