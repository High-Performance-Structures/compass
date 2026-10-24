"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { projectJobStatuses, projectProfileAuditEvents, projects } from "@/db/schema"
import { projectWorkflowChecks } from "@/db/schema-job-workflows"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { DEPARTMENT_WORKFLOWS } from "@/lib/job-workflows/departments"
import { applyWorkflowOverrides, workflowProgress, type WorkflowProgress } from "@/lib/job-workflows/engine"
import { forwardJobStatusSuggestion, workflowCatchUp } from "@/lib/job-workflows/status"
import { carryOverWorkflowChecks, linkedProjectIds } from "@/lib/job-workflows/carryover"
import { chunkD1Rows } from "@/lib/d1-query"
import { loadWorkflowChecks, readWorkflowCustomization, jobWorkflowFacts } from "@/lib/job-workflows/server"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { loadProjectFollowUpSignals } from "@/lib/project-aging-server"
import { projectDepartment, type ProjectDepartment } from "@/lib/project-branding"
import type { ProjectFollowUpSignal } from "@/lib/project-follow-up"
import { projectJobStatusLabel } from "@/lib/project-profile"
import { getProjectAccessRecord } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type JobWorkflowOverview = {
  readonly projectId: string
  readonly department: ProjectDepartment
  readonly progress: WorkflowProgress
  readonly followUp: ProjectFollowUpSignal | null
  readonly jobStatus: { readonly id: string; readonly label: string }
  /** The current step's usual job status when it would move the job forward. */
  readonly suggestedJobStatus: { readonly id: string; readonly label: string } | null
  /** Offered when the job's status is ahead of its checklist (jobs already underway). */
  readonly catchUp: { readonly stepLabel: string; readonly itemCount: number } | null
  /** Offered when linked jobs (a Design job, say) completed items this job hasn't ticked. */
  readonly carryover: { readonly itemCount: number } | null
}

type Db = ReturnType<typeof getDb>

async function context(projectId: string, action: "read" | "update") {
  const user = await requireAuth()
  if (!isInternalStaffRole(user.role)) throw new Error("Job workflows are available to office staff.")
  await requireFeaturePermission(user, "project-hub", action)
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  if (!env?.DB) throw new Error("Database unavailable")
  const db = getDb(env.DB)
  const access = await getProjectAccessRecord(db, user, projectId)
  if (!access || access.organizationId !== organizationId) throw new Error("Project not found or access denied.")
  return { db, organizationId, user }
}

/**
 * A job's department workflow for its overview: steps, the current step's
 * checklist, and the job status the step usually goes with. Null for
 * departments without a workflow here (Nu-Tech has its own order loader).
 */
async function loadOverview(db: Db, organizationId: string, projectId: string): Promise<JobWorkflowOverview | null> {
  const project = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      address: projects.address,
      jobStatusId: projects.jobStatusId,
      googleDriveFolderId: projects.googleDriveFolderId,
      workspaceKind: projects.workspaceKind,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .get()
  // Internal workspaces (H-Office, the yard) show their own panel, not a client-job workflow.
  if (!project || project.workspaceKind) return null
  const department = projectDepartment({ projectId: project.id, projectNumber: project.projectNumber })
  const definition = department === "N" ? undefined : DEPARTMENT_WORKFLOWS[department]
  if (!definition) return null

  const [facts, checks, customization, followUps, customStatus] = await Promise.all([
    jobWorkflowFacts(db, { ...project, department }),
    loadWorkflowChecks(db, organizationId, projectId),
    readWorkflowCustomization(db, organizationId, department),
    loadProjectFollowUpSignals(db, organizationId, [project], new Date()).catch(() => new Map<string, ProjectFollowUpSignal>()),
    db
      .select({ label: projectJobStatuses.label })
      .from(projectJobStatuses)
      .where(and(eq(projectJobStatuses.id, project.jobStatusId), eq(projectJobStatuses.organizationId, organizationId)))
      .get(),
  ])
  const progress = workflowProgress(applyWorkflowOverrides(definition, customization.overrides, customization.layout), facts, checks)
  const carryoverCount = await pendingCarryover(db, organizationId, projectId).catch(() => 0)
  const suggestedId = forwardJobStatusSuggestion(progress, project.jobStatusId)
  const catchUp = workflowCatchUp(progress, project.jobStatusId)
  return {
    projectId,
    department,
    progress,
    followUp: followUps.get(projectId) ?? null,
    jobStatus: { id: project.jobStatusId, label: projectJobStatusLabel({ jobStatusId: project.jobStatusId, customLabel: customStatus?.label ?? null }) },
    suggestedJobStatus:
      suggestedId && !catchUp ? { id: suggestedId, label: projectJobStatusLabel({ jobStatusId: suggestedId, customLabel: null }) } : null,
    catchUp: catchUp ? { stepLabel: catchUp.stepLabel, itemCount: catchUp.itemKeys.length } : null,
    carryover: carryoverCount > 0 ? { itemCount: carryoverCount } : null,
  }
}

/** How many items linked jobs completed that would carry onto this job. */
async function pendingCarryover(db: Db, organizationId: string, projectId: string): Promise<number> {
  const linked = await linkedProjectIds(db, organizationId, projectId)
  let total = 0
  for (const sourceProjectId of linked) {
    total += await carryOverWorkflowChecks(db, { organizationId, sourceProjectId, targetProjectId: projectId, actorUserId: null, dryRun: true })
  }
  return total
}

/**
 * Tick the items this job's linked jobs already completed (a Design job's
 * agreement, retainer and drawings on its Construction job), keeping who
 * ticked them and when. Ticks already on this job stay as they are.
 */
export async function carryOverLinkedJobWorkflows(projectId: string): Promise<Result<{ readonly ticked: number }>> {
  try {
    const { db, organizationId, user } = await context(projectId, "update")
    if (isDemoUser(user.id) || isDemoOrg(organizationId)) return { success: false, error: "Demo data cannot be changed." }
    let ticked = 0
    for (const sourceProjectId of await linkedProjectIds(db, organizationId, projectId)) {
      ticked += await carryOverWorkflowChecks(db, { organizationId, sourceProjectId, targetProjectId: projectId, actorUserId: user.id })
    }
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, data: { ticked } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to carry over the checklist." }
  }
}

/**
 * A job's department workflow for its overview: steps, the current step's
 * checklist, and the job status the step usually goes with. Null for
 * departments without a workflow here (Nu-Tech has its own order loader).
 */
export async function getJobWorkflowOverview(projectId: string): Promise<JobWorkflowOverview | null> {
  try {
    const { db, organizationId } = await context(projectId, "read")
    return await loadOverview(db, organizationId, projectId)
  } catch (error) {
    console.error("Job workflow overview unavailable", error)
    return null
  }
}

/**
 * Tick the open items before the step the job's status says it has reached,
 * for jobs already underway. Recomputed here rather than trusted from the page.
 */
export async function catchUpJobWorkflow(projectId: string): Promise<Result<{ readonly ticked: number }>> {
  try {
    const { db, organizationId, user } = await context(projectId, "update")
    if (isDemoUser(user.id) || isDemoOrg(organizationId)) return { success: false, error: "Demo data cannot be changed." }
    const overview = await loadOverview(db, organizationId, projectId)
    const catchUp = overview ? workflowCatchUp(overview.progress, overview.jobStatus.id) : null
    if (!catchUp) return { success: true, data: { ticked: 0 } }
    const now = new Date().toISOString()
    const rows = catchUp.itemKeys.map((itemKey) => ({
      id: crypto.randomUUID(),
      organizationId,
      projectId,
      itemKey,
      checkedBy: user.id,
      checkedAt: now,
    }))
    for (const chunk of chunkD1Rows(rows)) {
      await db.insert(projectWorkflowChecks).values(chunk).onConflictDoNothing()
    }
    await db.insert(projectProfileAuditEvents).values({
      id: crypto.randomUUID(),
      organizationId,
      projectId,
      actorUserId: user.id,
      eventType: "workflow_caught_up",
      entityType: "project_workflow_check",
      entityId: null,
      beforeJson: JSON.stringify({ step: overview?.progress.current?.id ?? null }),
      afterJson: JSON.stringify({ throughStep: catchUp.stepLabel, itemKeys: catchUp.itemKeys }),
      createdAt: now,
    })
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, data: { ticked: rows.length } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to update the checklist." }
  }
}

const ITEM_KEY = /^[a-z0-9_-]{1,60}\.[a-z0-9_-]{1,60}$/

/** Tick or untick a checklist item on a job's workflow. */
export async function setJobWorkflowCheck(input: {
  readonly projectId: string
  readonly itemKey: string
  readonly checked: boolean
}): Promise<Result<null>> {
  try {
    if (!ITEM_KEY.test(input.itemKey)) return { success: false, error: "Unknown checklist item." }
    const { db, organizationId, user } = await context(input.projectId, "update")
    if (isDemoUser(user.id) || isDemoOrg(organizationId)) return { success: false, error: "Demo data cannot be changed." }
    const now = new Date().toISOString()
    const audit = db.insert(projectProfileAuditEvents).values({
      id: crypto.randomUUID(),
      organizationId,
      projectId: input.projectId,
      actorUserId: user.id,
      eventType: input.checked ? "workflow_item_checked" : "workflow_item_unchecked",
      entityType: "project_workflow_check",
      entityId: input.itemKey,
      beforeJson: JSON.stringify({ checked: !input.checked }),
      afterJson: JSON.stringify({ checked: input.checked }),
      createdAt: now,
    })
    if (input.checked) {
      await db.batch([
        db
          .insert(projectWorkflowChecks)
          .values({
            id: crypto.randomUUID(),
            organizationId,
            projectId: input.projectId,
            itemKey: input.itemKey,
            checkedBy: user.id,
            checkedAt: now,
          })
          .onConflictDoNothing(),
        audit,
      ])
    } else {
      await db.batch([
        db
          .delete(projectWorkflowChecks)
          .where(
            and(
              eq(projectWorkflowChecks.projectId, input.projectId),
              eq(projectWorkflowChecks.organizationId, organizationId),
              eq(projectWorkflowChecks.itemKey, input.itemKey),
            ),
          ),
        audit,
      ])
    }
    revalidatePath(`/dashboard/projects/${input.projectId}`)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to update the checklist." }
  }
}
