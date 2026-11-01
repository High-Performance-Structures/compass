/**
 * A project's job status and the other single settings changed from the
 * project hub (delivery method, portfolio map visibility), plus the
 * company's own job statuses.
 */
import { and, asc, eq } from "drizzle-orm"

import { projectJobStatusLabelKeys, projectJobStatuses, projects } from "@/db/schema"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import { profileOrgContext, projectProfileContext } from "@/lib/domain/project/profile-access"
import type { ProjectProfileResult } from "@/lib/domain/project/profile-rules"
import { insertProjectJobStatus, updateProjectsStatement } from "@/lib/domain/project/store"
import { canFeature } from "@/lib/permission-enforcement"
import { canManageProjectRegistry } from "@/lib/permissions"
import { isPortfolioMapVisibility } from "@/lib/portfolio-map/visibility"
import {
  PROJECT_JOB_STATUS_DEFINITIONS,
  isBuiltInProjectJobStatusId,
  isBuiltInProjectJobStatusLabel,
  isSupportedProjectJobStatusLabel,
  normalizeProjectJobStatusLabel,
} from "@/lib/project-profile"
import { isDeliveryMethod } from "@/lib/sales-pipeline/stages"
import type { Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"
import { isInternalStaffRole } from "@/lib/user-roles"

/** A built-in status, or one of the company's active custom statuses. */
export async function validJobStatus(input: {
  readonly db: Db
  readonly organizationId: string
  readonly jobStatusId: string
}): Promise<boolean> {
  if (PROJECT_JOB_STATUS_DEFINITIONS.some((status) => status.id === input.jobStatusId)) {
    return true
  }
  const custom = await input.db
    .select({ id: projectJobStatuses.id })
    .from(projectJobStatuses)
    .where(
      and(
        eq(projectJobStatuses.organizationId, input.organizationId),
        eq(projectJobStatuses.id, input.jobStatusId),
        eq(projectJobStatuses.active, true),
      ),
    )
    .limit(1)
  return custom.length === 1
}

type ProjectSetting = "jobStatusId" | "deliveryMethod" | "portfolioMapVisibility" | "importedConversationsStaffOnly"

/**
 * Reads one project setting, and when the value changes writes it with an
 * audit entry in one batch. An unchanged value is a successful no-op.
 */
async function changeProjectSetting<K extends ProjectSetting>(input: {
  readonly projectId: string
  readonly column: K
  readonly value: NonNullable<(typeof projects.$inferInsert)[K]> | null
  readonly eventType: string
  readonly validate: () => string | null
}): Promise<ProjectProfileResult & { readonly changed?: boolean }> {
  const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
  if (isDemoUser(user.id) || isDemoOrg(organizationId)) {
    return { success: false, error: "Demo data cannot be changed." }
  }
  const problem = input.validate()
  if (problem) return { success: false, error: problem }

  const scope = and(eq(projects.id, input.projectId), eq(projects.organizationId, organizationId))
  const existingRows = await db
    .select({ value: projects[input.column] })
    .from(projects)
    .where(scope)
    .limit(1)
  const existing = existingRows[0]
  if (!existing) return { success: false, error: "Project not found." }
  if (existing.value === input.value) return { success: true, changed: false }

  const updatedAt = new Date().toISOString()
  await db.batch([
    updateProjectsStatement(db, scope, { [input.column]: input.value, updatedAt }),
    recordProjectAudit(db, {
      organizationId,
      projectId: input.projectId,
      actorUserId: user.id,
      eventType: input.eventType,
      entityType: "project",
      entityId: input.projectId,
      beforeJson: JSON.stringify({ [input.column]: existing.value }),
      afterJson: JSON.stringify({ [input.column]: input.value }),
      createdAt: updatedAt,
    }),
  ])
  return { success: true, changed: true }
}

export async function changeProjectJobStatus(input: {
  readonly projectId: string
  readonly jobStatusId: string
}): Promise<ProjectProfileResult & { readonly changed?: boolean }> {
  return changeProjectSetting({
    projectId: input.projectId,
    column: "jobStatusId",
    value: input.jobStatusId,
    eventType: "project_job_status_updated",
    validate: () => (isBuiltInProjectJobStatusId(input.jobStatusId) ? null : "Choose a listed project status."),
  })
}

export async function changeProjectDeliveryMethod(input: {
  readonly projectId: string
  readonly deliveryMethod: string | null
}): Promise<ProjectProfileResult & { readonly changed?: boolean }> {
  const deliveryMethod = input.deliveryMethod
  return changeProjectSetting({
    projectId: input.projectId,
    column: "deliveryMethod",
    value: deliveryMethod !== null && isDeliveryMethod(deliveryMethod) ? deliveryMethod : null,
    eventType: "project_delivery_method_updated",
    validate: () =>
      deliveryMethod !== null && !isDeliveryMethod(deliveryMethod) ? "Choose delivery or customer pickup." : null,
  })
}

export async function changeProjectMapVisibility(input: {
  readonly projectId: string
  readonly visibility: string
}): Promise<ProjectProfileResult & { readonly changed?: boolean }> {
  const visibility = input.visibility
  return changeProjectSetting({
    projectId: input.projectId,
    column: "portfolioMapVisibility",
    value: isPortfolioMapVisibility(visibility) ? visibility : null,
    eventType: "project_map_visibility_updated",
    validate: () => (isPortfolioMapVisibility(visibility) ? null : "Choose a portfolio map setting."),
  })
}

/**
 * Keep this project's imported (e.g. Buildertrend) conversations internal:
 * owners and vendors lose access to them at once, even if they were members,
 * and imports add no outside people. Used for projects under a legal hold.
 */
export async function changeProjectImportedConversationsStaffOnly(input: {
  readonly projectId: string
  readonly staffOnly: boolean
}): Promise<ProjectProfileResult & { readonly changed?: boolean }> {
  return changeProjectSetting({
    projectId: input.projectId,
    column: "importedConversationsStaffOnly",
    value: input.staffOnly,
    eventType: "project_imported_conversations_staff_only_updated",
    validate: () => null,
  })
}

export type ProjectAgingStatusRow = {
  readonly id: string
  readonly label: string
  /** True for statuses the company added. */
  readonly custom: boolean
  /** Timing used when Settings has no entry; null means not followed up by default. */
  readonly defaultThresholds: { readonly dueDays: number; readonly overdueDays: number } | null
}

/** A status cadence becomes due on its cadence and overdue the day after. */
function defaultAgingThresholds(cadence: number | null): ProjectAgingStatusRow["defaultThresholds"] {
  return cadence === null ? null : { dueDays: cadence, overdueDays: cadence + 1 }
}

export async function loadProjectAgingStatusRows(): Promise<
  { readonly success: true; readonly rows: readonly ProjectAgingStatusRow[] } | { readonly success: false; readonly error: string }
> {
  const { db, organizationId, user } = await profileOrgContext()
  if (!isInternalStaffRole(user.role)) return { success: false, error: "Project aging settings are available to office staff." }
  const custom = await db
    .select({ id: projectJobStatuses.id, label: projectJobStatuses.label, cadenceDays: projectJobStatuses.followUpCadenceDays })
    .from(projectJobStatuses)
    .where(and(eq(projectJobStatuses.organizationId, organizationId), eq(projectJobStatuses.active, true)))
    .orderBy(asc(projectJobStatuses.sortOrder), asc(projectJobStatuses.label))
  return {
    success: true,
    rows: [
      ...PROJECT_JOB_STATUS_DEFINITIONS.map((status) => ({
        id: status.id,
        label: status.label,
        custom: false,
        defaultThresholds: defaultAgingThresholds(status.followUpCadenceDays),
      })),
      ...custom.map((status) => ({
        id: status.id,
        label: status.label,
        custom: true,
        defaultThresholds: defaultAgingThresholds(status.cadenceDays),
      })),
    ],
  }
}

export async function addCustomProjectJobStatus(input: {
  readonly label: string
  readonly sageCode: string | null
  readonly followUpCadenceDays: number | null
}): Promise<ProjectProfileResult> {
  const { db, organizationId, user } = await profileOrgContext()
  // The Project Hub permission was once called without await, so it never
  // blocked the save (and a denial surfaced as an unhandled rejection).
  if (!(await canFeature(user, "project-hub", "update"))) {
    return { success: false, error: `Permission denied: ${user.role} cannot update project-hub` }
  }
  if (!canManageProjectRegistry(user)) return { success: false, error: "Only project registry managers can add job statuses." }
  const label = cleanText(input.label)
  if (!label) return { success: false, error: "Enter a job-status label." }
  if (!isSupportedProjectJobStatusLabel(label)) {
    return {
      success: false,
      error: "Custom job-status labels must use printable basic Latin characters.",
    }
  }
  const normalizedLabel = normalizeProjectJobStatusLabel(label)
  if (isBuiltInProjectJobStatusLabel(label)) {
    return {
      success: false,
      error: "That standard status is already available in the Job status menu.",
    }
  }
  const existingCustomStatuses = await db
    .select({ statusId: projectJobStatusLabelKeys.statusId })
    .from(projectJobStatusLabelKeys)
    .where(
      and(
        eq(projectJobStatusLabelKeys.organizationId, organizationId),
        eq(projectJobStatusLabelKeys.normalizedLabel, normalizedLabel),
      ),
    )
    .limit(1)
  if (existingCustomStatuses.length > 0) {
    return { success: false, error: "That custom status already exists." }
  }
  if (input.followUpCadenceDays !== null && (!Number.isInteger(input.followUpCadenceDays) || input.followUpCadenceDays < 1)) {
    return { success: false, error: "Follow-up cadence must be a positive whole number." }
  }
  const timestamp = new Date().toISOString()
  await insertProjectJobStatus(db, {
    id: crypto.randomUUID(), organizationId, label, sageCode: cleanText(input.sageCode), followUpCadenceDays: input.followUpCadenceDays, active: true, sortOrder: 999, createdBy: user.id, createdAt: timestamp, updatedAt: timestamp,
  })
  return { success: true }
}
