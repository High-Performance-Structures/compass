/**
 * Which jobs appear in the field app (pure; no database access).
 *
 * Each job has one company-wide choice, the same for everyone:
 * - Automatic (stored as null): shown when the job's pipeline phase, from the
 *   company's job status → phase mapping (Settings › Workflows › Portfolio
 *   map), is one of the field app phases and its department isn't left out
 *   (Settings › Workflows › Field app).
 * - Always show ("shown"): shown in any phase or department.
 * - Hide ("hidden"): never shown.
 * Closed jobs (project status Complete, Archive or Inactive, or a job status
 * that counts as complete or inactive) never show, whatever the choice.
 */
import type { FieldAppVisibility } from "@/lib/domain/project/statuses"
import type { FieldAppSettings } from "@/lib/feature-settings/field-app-settings"
import { PORTFOLIO_PHASES, type PortfolioMapRules, type PortfolioPhaseId } from "@/lib/portfolio-map/phases"
import { phaseForJobStatus } from "@/lib/portfolio-map/model"
import { resolvedProjectDepartment } from "@/lib/project-branding"
import { projectJobStatusBucket } from "@/lib/project-profile"

/** The choice as the pages show it; "automatic" is a null column. */
const FIELD_APP_CHOICES = ["automatic", "shown", "hidden"] as const
export type FieldAppChoice = (typeof FIELD_APP_CHOICES)[number]

/** Legacy project statuses that mean the job is over. */
const CLOSED_PROJECT_STATUSES: readonly string[] = ["COMPLETE", "ARCHIVE", "INACTIVE"]

export type FieldAppJob = {
  readonly id: string
  readonly projectNumber: string | null
  readonly department: string | null
  /** projects.status (OPEN, OTHER, COMPLETE, ...). */
  readonly status: string
  readonly jobStatusId: string
  /** The job status's label (built-in or the company's own). */
  readonly jobStatusLabel: string
  readonly fieldAppVisibility: FieldAppVisibility | null
}

/** The company's rules: its field app settings and its job status → phase mapping. */
export type FieldAppRules = {
  readonly settings: FieldAppSettings
  readonly mapRules: PortfolioMapRules
}

type FieldAppReason =
  | "closed"
  | "hidden"
  | "always_shown"
  | "automatic_phase"
  | "automatic_department_excluded"
  | "automatic_phase_not_included"

export type FieldAppDecision = {
  readonly shown: boolean
  /** What Automatic would do (false for a closed job). */
  readonly automaticShows: boolean
  readonly choice: FieldAppChoice
  readonly reason: FieldAppReason
  readonly phase: PortfolioPhaseId | null
  readonly closed: boolean
}

function fieldAppChoice(visibility: FieldAppVisibility | null): FieldAppChoice {
  return visibility ?? "automatic"
}

/** The stored value for a choice: Automatic is null. */
export function fieldAppVisibilityFor(choice: FieldAppChoice): FieldAppVisibility | null {
  return choice === "automatic" ? null : choice
}

export function isFieldAppChoice(value: unknown): value is FieldAppChoice {
  return typeof value === "string" && FIELD_APP_CHOICES.some((choice) => choice === value)
}

/** Closed: the project status or the job status says the job is over. */
function isFieldAppClosedJob(job: Pick<FieldAppJob, "status" | "jobStatusId" | "jobStatusLabel">): boolean {
  if (CLOSED_PROJECT_STATUSES.includes(job.status.trim().toUpperCase())) return true
  const bucket = projectJobStatusBucket({ jobStatusId: job.jobStatusId, jobStatusLabel: job.jobStatusLabel })
  return bucket === "complete" || bucket === "inactive" || bucket === "archive"
}

export function fieldAppDecision(job: FieldAppJob, rules: FieldAppRules): FieldAppDecision {
  const choice = fieldAppChoice(job.fieldAppVisibility)
  const phase = phaseForJobStatus(job.jobStatusId, job.jobStatusLabel, rules.mapRules)
  const closed = isFieldAppClosedJob(job)
  const department = resolvedProjectDepartment({
    department: job.department,
    projectId: job.id,
    projectNumber: job.projectNumber,
  })
  const departmentExcluded = department !== null && rules.settings.excludedDepartments.includes(department)
  const phaseIncluded = phase !== null && rules.settings.phases.includes(phase)
  const automaticShows = !closed && !departmentExcluded && phaseIncluded
  const automaticReason: FieldAppReason = departmentExcluded
    ? "automatic_department_excluded"
    : phaseIncluded
      ? "automatic_phase"
      : "automatic_phase_not_included"

  if (closed) return { shown: false, automaticShows, choice, reason: "closed", phase, closed }
  if (choice === "hidden") return { shown: false, automaticShows, choice, reason: "hidden", phase, closed }
  if (choice === "shown") return { shown: true, automaticShows, choice, reason: "always_shown", phase, closed }
  return { shown: automaticShows, automaticShows, choice, reason: automaticReason, phase, closed }
}

function phaseLabel(phase: PortfolioPhaseId | null): string {
  return PORTFOLIO_PHASES.find((entry) => entry.id === phase)?.label ?? "no pipeline phase"
}

/** One line for the page: whether the job is in the field app and why. */
export function fieldAppDecisionSummary(decision: FieldAppDecision, department: string | null): string {
  const automatic = decision.automaticShows
    ? `Automatic would show it (${phaseLabel(decision.phase)}).`
    : "Automatic would not show it."
  switch (decision.reason) {
    case "closed":
      return "Not in the field app: closed jobs never show."
    case "hidden":
      return `Hidden from the field app. ${automatic}`
    case "always_shown":
      return `In the field app (Always show). ${automatic}`
    case "automatic_phase":
      return `In the field app: ${phaseLabel(decision.phase)} is a field app phase.`
    case "automatic_department_excluded":
      return `Not in the field app: ${department ?? "this department"} jobs are left out on Automatic.`
    case "automatic_phase_not_included":
      return `Not in the field app: its job status is in ${phaseLabel(decision.phase)}, which isn't a field app phase.`
  }
}

/** A row of Settings › Workflows › Field app (plain data for the browser). */
export type FieldAppJobListRow = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly department: string | null
  readonly jobStatusLabel: string
  readonly choice: FieldAppChoice
  readonly shown: boolean
  readonly summary: string
}
