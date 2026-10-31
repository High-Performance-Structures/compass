"use server"

import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import type { ProjectEstimateActionResult } from "@/lib/domain/estimates/types"
import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { projectEstimateLines, projectEstimateReportPhases, projectEstimates } from "@/db/schema-estimates"
import { recordActivityEvent } from "@/lib/activity-log"
import type { AuthUser } from "@/lib/auth"
import { validateEstimateReportPhase, type EstimateReportPhaseInput } from "@/lib/estimates/report-phases"
import { estimateCanBeEdited, isEstimateStatus } from "@/lib/domain/estimates/rules"
import {
  deleteEstimateReportPhasesStatement,
  insertEstimateReportPhaseStatement,
  invalidatePreparedSignatureStatement,
  updateEstimateLinesStatement,
  updateEstimateReportPhasesStatement,
  type Statement,
} from "@/lib/domain/estimates/store"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"
import { requireUserContext } from "@/lib/server/action-context"

type PhaseAccess = {
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly organizationId: string | null
}

async function phaseAccess(projectId: string, estimateId: string, deleting: boolean): Promise<PhaseAccess> {
  const { user, db } = await requireUserContext()
  requirePermission(user, "budget", deleting ? "delete" : "update")
  if (!isInternalStaffRole(user.role)) throw new Error("Only authorized internal staff can edit estimate phases.")
  await assertProjectAccess(db, user, projectId)
  const [estimateRows, projectRows] = await Promise.all([
    db.select({ status: projectEstimates.status }).from(projectEstimates).where(and(eq(projectEstimates.id, estimateId), eq(projectEstimates.projectId, projectId))).limit(1),
    db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId)).limit(1),
  ])
  const estimate = estimateRows[0]
  const project = projectRows[0]
  if (!estimate || !project) throw new Error("Estimate not found.")
  if (!isEstimateStatus(estimate.status) || !estimateCanBeEdited(estimate.status)) {
    throw new Error("This estimate is locked. Create a revision before changing report phases.")
  }
  return { db, user, organizationId: project.organizationId }
}

function revalidatePhaseReport(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/estimate`)
  revalidatePath(`/print/projects/${projectId}/estimate`)
  revalidatePath(`/dashboard/projects/${projectId}/estimate/compare`)
  revalidatePath(`/print/projects/${projectId}/estimate/compare`)
}

export async function saveProjectEstimateReportPhase(
  projectId: string,
  estimateId: string,
  phaseId: string | null,
  input: EstimateReportPhaseInput
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await phaseAccess(projectId, estimateId, false)
    const lines = await access.db.select({ id: projectEstimateLines.id, divisionCode: projectEstimateLines.divisionCode }).from(projectEstimateLines).where(and(eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.projectId, projectId)))
    const validation = validateEstimateReportPhase(input, lines)
    if (!validation.success) return validation
    const value = validation.value
    if (phaseId) {
      const existing = await access.db.select({ id: projectEstimateReportPhases.id }).from(projectEstimateReportPhases).where(and(eq(projectEstimateReportPhases.id, phaseId), eq(projectEstimateReportPhases.estimateId, estimateId), eq(projectEstimateReportPhases.projectId, projectId))).limit(1)
      if (!existing[0]) throw new Error("Report phase not found.")
    }
    const id = phaseId ?? crypto.randomUUID()
    const now = new Date().toISOString()
    const values = { divisionCode: value.divisionCode, name: value.name, description: value.description, itemize: value.itemize, sortOrder: value.sortOrder, updatedAt: now }
    const phaseWrite = phaseId
      ? updateEstimateReportPhasesStatement(access.db, and(eq(projectEstimateReportPhases.id, id), eq(projectEstimateReportPhases.estimateId, estimateId)), values)
      : insertEstimateReportPhaseStatement(access.db, { id, projectId, estimateId, ...values, createdAt: now })
    // Phase definition and membership change together; no cost or CSI field changes.
    const assignmentWrites: Statement[] = []
    // D1 limits parameters per statement, not the size of an estimate phase.
    for (let offset = 0; offset < value.lineIds.length; offset += 80) {
      assignmentWrites.push(updateEstimateLinesStatement(access.db, and(eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.projectId, projectId), eq(projectEstimateLines.divisionCode, value.divisionCode), inArray(projectEstimateLines.id, value.lineIds.slice(offset, offset + 80))), { reportPhaseId: id, updatedAt: now }))
    }
    await access.db.batch([
      phaseWrite,
      updateEstimateLinesStatement(access.db, and(eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.reportPhaseId, id)), { reportPhaseId: null, updatedAt: now }),
      ...assignmentWrites,
      invalidatePreparedSignatureStatement(access.db, estimateId, now),
    ])
    if (access.organizationId) {
      await recordActivityEvent({
        db: access.db, organizationId: access.organizationId, projectId, actor: access.user,
        category: "financial", action: phaseId ? "estimate_report_phase_updated" : "estimate_report_phase_created",
        entityType: "project_estimate_report_phase", entityId: id,
        summary: `${phaseId ? "Updated" : "Created"} estimate report phase ${value.name}.`,
        metadata: { estimateId, divisionCode: value.divisionCode, itemize: value.itemize, lineCount: value.lineIds.length }, createdAt: now,
      })
    }
    revalidatePhaseReport(projectId)
    return { success: true, id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to save the report phase." }
  }
}

export async function deleteProjectEstimateReportPhase(
  projectId: string,
  estimateId: string,
  phaseId: string
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await phaseAccess(projectId, estimateId, true)
    const rows = await access.db.select().from(projectEstimateReportPhases).where(and(eq(projectEstimateReportPhases.id, phaseId), eq(projectEstimateReportPhases.estimateId, estimateId), eq(projectEstimateReportPhases.projectId, projectId))).limit(1)
    const phase = rows[0]
    if (!phase) throw new Error("Report phase not found.")
    const now = new Date().toISOString()
    await access.db.batch([
      updateEstimateLinesStatement(access.db, and(eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.reportPhaseId, phaseId)), { reportPhaseId: null, updatedAt: now }),
      deleteEstimateReportPhasesStatement(access.db, and(eq(projectEstimateReportPhases.id, phaseId), eq(projectEstimateReportPhases.estimateId, estimateId))),
      invalidatePreparedSignatureStatement(access.db, estimateId, now),
    ])
    if (access.organizationId) {
      await recordActivityEvent({
        db: access.db, organizationId: access.organizationId, projectId, actor: access.user,
        category: "financial", action: "estimate_report_phase_deleted", entityType: "project_estimate_report_phase", entityId: phaseId,
        summary: `Deleted report phase ${phase.name}; all estimate costs were preserved.`,
        metadata: { estimateId, name: phase.name, description: phase.description, divisionCode: phase.divisionCode, itemize: phase.itemize, sortOrder: phase.sortOrder }, createdAt: now,
      })
    }
    revalidatePhaseReport(projectId)
    return { success: true, id: phaseId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to delete the report phase." }
  }
}
