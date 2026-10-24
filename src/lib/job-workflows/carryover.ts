import { and, eq, inArray, or } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectProfileAuditEvents, projects } from "@/db/schema"
import { projectLinks } from "@/db/schema-project-links"
import { projectWorkflowChecks } from "@/db/schema-job-workflows"
import { chunkD1Rows } from "@/lib/d1-query"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { DEPARTMENT_WORKFLOWS } from "@/lib/job-workflows/departments"
import { applyWorkflowOverrides, workflowItemKey } from "@/lib/job-workflows/engine"
import { readWorkflowCustomization } from "@/lib/job-workflows/server"
import { carriedTicks, carryoverFor } from "@/lib/job-workflows/carryover-defaults"
import { projectDepartment, type ProjectDepartment } from "@/lib/project-branding"

type Db = ReturnType<typeof getDb>

/** Item keys someone may tick in a department's workflow, with the company's changes applied. */
async function tickableKeys(db: Db, organizationId: string, department: ProjectDepartment): Promise<ReadonlySet<string>> {
  const definition = department === "N" ? undefined : DEPARTMENT_WORKFLOWS[department]
  if (!definition) return new Set()
  const customization = await readWorkflowCustomization(db, organizationId, department)
  const applied = applyWorkflowOverrides(definition, customization.overrides, customization.layout)
  return new Set(
    applied.steps.flatMap((step) =>
      step.items
        .filter((item) => item.fact === undefined || item.tickable === true)
        .map((item) => workflowItemKey(step.id, item.id))
    )
  )
}

/**
 * Tick a job's workflow items that its linked job in another department
 * already completed, keeping who ticked them and when. Returns how many were
 * carried; `dryRun` only counts them.
 */
export async function carryOverWorkflowChecks(
  db: Db,
  input: {
    readonly organizationId: string
    readonly sourceProjectId: string
    readonly targetProjectId: string
    readonly actorUserId: string | null
    readonly dryRun?: boolean
  }
): Promise<number> {
  const rows = await db
    .select({ id: projects.id, projectNumber: projects.projectNumber, workspaceKind: projects.workspaceKind })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, input.organizationId),
        inArray(projects.id, [input.sourceProjectId, input.targetProjectId])
      )
    )
  const source = rows.find((row) => row.id === input.sourceProjectId)
  const target = rows.find((row) => row.id === input.targetProjectId)
  if (!source || !target || source.workspaceKind || target.workspaceKind) return 0
  const from = projectDepartment({ projectId: source.id, projectNumber: source.projectNumber })
  const to = projectDepartment({ projectId: target.id, projectNumber: target.projectNumber })
  if (from === to) return 0
  const settings = await readFeatureSettings(db, input.organizationId, "job-workflows")
  const carryover = carryoverFor(settings.carryovers, from, to)
  if (!carryover) return 0

  const [sourceChecks, targetChecks, targetTickable] = await Promise.all([
    db
      .select({
        itemKey: projectWorkflowChecks.itemKey,
        checkedBy: projectWorkflowChecks.checkedBy,
        checkedAt: projectWorkflowChecks.checkedAt,
      })
      .from(projectWorkflowChecks)
      .where(and(eq(projectWorkflowChecks.projectId, source.id), eq(projectWorkflowChecks.organizationId, input.organizationId))),
    db
      .select({ itemKey: projectWorkflowChecks.itemKey })
      .from(projectWorkflowChecks)
      .where(and(eq(projectWorkflowChecks.projectId, target.id), eq(projectWorkflowChecks.organizationId, input.organizationId))),
    tickableKeys(db, input.organizationId, to),
  ])
  const ticks = carriedTicks({
    items: carryover.items,
    sourceChecks,
    targetTickableKeys: targetTickable,
    targetCheckedKeys: new Set(targetChecks.map((row) => row.itemKey)),
  })
  if (ticks.length === 0 || input.dryRun) return ticks.length

  const now = new Date().toISOString()
  const inserts = ticks.map((tick) => ({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    projectId: target.id,
    itemKey: tick.targetKey,
    checkedBy: tick.checkedBy,
    checkedAt: tick.checkedAt,
    carriedFromProjectId: source.id,
    carriedFromItemKey: tick.sourceKey,
  }))
  for (const chunk of chunkD1Rows(inserts)) {
    await db.insert(projectWorkflowChecks).values(chunk).onConflictDoNothing()
  }
  await db.insert(projectProfileAuditEvents).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    projectId: target.id,
    actorUserId: input.actorUserId,
    eventType: "workflow_carried_over",
    entityType: "project_workflow_check",
    entityId: null,
    beforeJson: JSON.stringify({ fromProjectId: source.id, fromProjectNumber: source.projectNumber }),
    afterJson: JSON.stringify({ items: ticks.map((tick) => ({ from: tick.sourceKey, to: tick.targetKey })) }),
    createdAt: now,
  })
  return ticks.length
}

/** Jobs linked to this one, either way round. */
export async function linkedProjectIds(db: Db, organizationId: string, projectId: string): Promise<readonly string[]> {
  const rows = await db
    .select({ projectId: projectLinks.projectId, linkedProjectId: projectLinks.linkedProjectId })
    .from(projectLinks)
    .where(
      and(
        eq(projectLinks.organizationId, organizationId),
        or(eq(projectLinks.projectId, projectId), eq(projectLinks.linkedProjectId, projectId))
      )
    )
  return [...new Set(rows.map((row) => (row.projectId === projectId ? row.linkedProjectId : row.projectId)))]
}

/**
 * Carry each linked job's completed items onto this job, and this job's onto
 * them, wherever a carryover applies (Design → Construction by default).
 */
export async function carryOverBetweenLinkedJobs(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly otherProjectId: string; readonly actorUserId: string | null }
): Promise<number> {
  const forward = await carryOverWorkflowChecks(db, {
    organizationId: input.organizationId,
    sourceProjectId: input.projectId,
    targetProjectId: input.otherProjectId,
    actorUserId: input.actorUserId,
  })
  const backward = await carryOverWorkflowChecks(db, {
    organizationId: input.organizationId,
    sourceProjectId: input.otherProjectId,
    targetProjectId: input.projectId,
    actorUserId: input.actorUserId,
  })
  return forward + backward
}
