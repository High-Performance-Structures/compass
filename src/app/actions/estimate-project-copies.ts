"use server"

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { revalidatePath } from "next/cache"

import { createProjectEstimateDraft } from "@/app/actions/project-estimates"
import {
  projectEstimateAssemblies,
  projectEstimateAssemblyCopies,
  projectEstimateLineCostItems,
  projectEstimateLines,
  projectEstimateReportPhases,
  projectEstimates,
} from "@/db/schema-estimates"
import { projectLinks } from "@/db/schema-project-links"
import { recordActivityEvent } from "@/lib/activity-log"
import { estimateAccess, requireEditableEstimate, revalidateEstimate, type CompassDb } from "@/lib/estimates/access"
import { copyEstimateLines, markupBasisPoints, UNASSIGNED_ITEMS, UNASSIGNED_NAME } from "@/lib/estimates/assembly-copy"
import { isContractEstimate } from "@/lib/estimates/estimate-family"
import { readEstimateMode } from "@/lib/estimates/numbering"
import { estimateTotalsForLines } from "@/lib/estimates/phase-proposals"
import { estimateCanBeEdited, isEstimateStatus } from "@/lib/financials/estimate-ledger"
import { readFeatureSettings } from "@/lib/feature-settings/server"

/*
 * Copy an estimate, or some of its assemblies, into another job's estimate:
 * for example a general contract job's scope offered as subcontract work on
 * an HPS job. The source estimate is never changed.
 */

export type EstimateCopyResult =
  | { readonly success: true; readonly projectId: string; readonly estimateId: string; readonly estimateNumber: string }
  | { readonly success: false; readonly error: string }

export type EstimateCopyTargetDraft = {
  readonly id: string
  readonly estimateNumber: string
  readonly versionNumber: number
  readonly title: string
  readonly kind: "contract" | "change_order" | "phase"
}

export type EstimateCopyTarget = {
  readonly projectId: string
  readonly projectNumber: string | null
  readonly projectName: string
  /** The target department's markup for copied items, or null to keep the source markup. */
  readonly markupPercent: number | null
  readonly drafts: readonly EstimateCopyTargetDraft[]
  /** Null when a new draft can be made; otherwise why not. */
  readonly newDraftBlocked: string | null
}

export type EstimateAssemblyCopySummary = {
  readonly id: string
  readonly sourceAssemblyId: string | null
  readonly assemblyName: string
  readonly targetProjectId: string
  readonly targetEstimateId: string
  readonly targetEstimateNumber: string
  readonly createdAt: string
}

async function copyMarkupPercent(db: CompassDb, organizationId: string | null, department: string): Promise<number | null> {
  if (!organizationId) return null
  try {
    const settings = await readFeatureSettings(db, organizationId, "estimates")
    return settings.copyMarkupPercents?.[department] ?? null
  } catch {
    return null
  }
}

function draftKind(estimate: typeof projectEstimates.$inferSelect): EstimateCopyTargetDraft["kind"] {
  if (estimate.changeOrderId) return "change_order"
  if (estimate.phaseProposalId) return "phase"
  return "contract"
}

/** Where items can be copied to on a job: its open drafts, or a new draft. */
export async function getEstimateCopyTarget(targetProjectId: string): Promise<EstimateCopyTarget | { readonly error: string }> {
  try {
    const access = await estimateAccess(targetProjectId, true)
    const [estimates, mode, markupPercent] = await Promise.all([
      access.db
        .select()
        .from(projectEstimates)
        .where(eq(projectEstimates.projectId, targetProjectId))
        .orderBy(desc(projectEstimates.updatedAt)),
      readEstimateMode(access.db, access.organizationId, access.department),
      copyMarkupPercent(access.db, access.organizationId, access.department),
    ])
    const drafts = estimates
      .filter((estimate) => isEstimateStatus(estimate.status) && estimateCanBeEdited(estimate.status))
      .map((estimate) => ({
        id: estimate.id,
        estimateNumber: estimate.estimateNumber,
        versionNumber: estimate.versionNumber,
        title: estimate.title,
        kind: draftKind(estimate),
      }))
    // One-contract-estimate jobs: a new draft would be a new version that
    // replaces the contract, so added scope goes in the open draft or a change order.
    const contract = estimates.filter((estimate) => isContractEstimate(estimate) && estimate.status !== "void" && estimate.status !== "superseded")
    const newDraftBlocked = mode === "single" && contract.length > 0
      ? contract.some((estimate) => estimate.status === "accepted")
        ? "This job's contract estimate is accepted. Start a change order estimate on the job and copy into that."
        : "This job already has a contract estimate. Copy into its open draft."
      : null
    return {
      projectId: targetProjectId,
      projectNumber: access.projectNumber,
      projectName: access.projectName,
      markupPercent,
      drafts,
      newDraftBlocked,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to open that job's estimates." }
  }
}

/** Where this estimate's assemblies have been copied, newest first. */
export async function getEstimateAssemblyCopies(projectId: string, estimateId: string): Promise<readonly EstimateAssemblyCopySummary[]> {
  const access = await estimateAccess(projectId, false)
  const rows = await access.db
    .select()
    .from(projectEstimateAssemblyCopies)
    .where(and(eq(projectEstimateAssemblyCopies.sourceProjectId, projectId), eq(projectEstimateAssemblyCopies.sourceEstimateId, estimateId)))
    .orderBy(desc(projectEstimateAssemblyCopies.createdAt))
  return rows.map((row) => ({
    id: row.id,
    sourceAssemblyId: row.sourceAssemblyId,
    assemblyName: row.assemblyName,
    targetProjectId: row.targetProjectId,
    targetEstimateId: row.targetEstimateId,
    targetEstimateNumber: row.targetEstimateNumber,
    createdAt: row.createdAt,
  }))
}

/**
 * Copies assemblies (or UNASSIGNED_ITEMS) of an estimate into an open draft
 * on another job, or a new draft when `targetEstimateId` is null. Quantities
 * and unit costs carry over; `markupPercent` replaces line markup (null keeps
 * the source markup). The two jobs are linked if they weren't already.
 */
export async function copyEstimateAssembliesToProject(input: {
  readonly sourceProjectId: string
  readonly sourceEstimateId: string
  readonly assemblyIds: readonly string[]
  readonly targetProjectId: string
  readonly targetEstimateId: string | null
  readonly markupPercent: number | null
}): Promise<EstimateCopyResult> {
  try {
    if (input.sourceProjectId === input.targetProjectId) throw new Error("Choose a different job to copy into.")
    if (input.assemblyIds.length === 0) throw new Error("Choose at least one assembly to copy.")
    const source = await estimateAccess(input.sourceProjectId, false)
    const target = await estimateAccess(input.targetProjectId, true)
    if (!source.organizationId || source.organizationId !== target.organizationId) {
      throw new Error("Both jobs must belong to the same company.")
    }
    const sourceEstimate = await source.db
      .select()
      .from(projectEstimates)
      .where(and(eq(projectEstimates.id, input.sourceEstimateId), eq(projectEstimates.projectId, input.sourceProjectId)))
      .get()
    if (!sourceEstimate) throw new Error("Estimate not found.")

    const wantsUnassigned = input.assemblyIds.includes(UNASSIGNED_ITEMS)
    const assemblyIds = input.assemblyIds.filter((id) => id !== UNASSIGNED_ITEMS)
    const db = target.db
    const [assemblies, lines, reportPhases] = await Promise.all([
      assemblyIds.length > 0
        ? db
            .select()
            .from(projectEstimateAssemblies)
            .where(and(eq(projectEstimateAssemblies.estimateId, sourceEstimate.id), inArray(projectEstimateAssemblies.id, assemblyIds)))
            .orderBy(projectEstimateAssemblies.sortOrder)
        : Promise.resolve([]),
      db
        .select()
        .from(projectEstimateLines)
        .where(and(
          eq(projectEstimateLines.estimateId, sourceEstimate.id),
          eq(projectEstimateLines.projectId, input.sourceProjectId),
          or(
            assemblyIds.length > 0 ? inArray(projectEstimateLines.assemblyId, assemblyIds) : undefined,
            wantsUnassigned ? isNull(projectEstimateLines.assemblyId) : undefined,
          ),
        )),
      db.select().from(projectEstimateReportPhases).where(eq(projectEstimateReportPhases.estimateId, sourceEstimate.id)),
    ])
    if (assemblies.length !== assemblyIds.length) throw new Error("An assembly was not found in this estimate. Refresh and try again.")
    if (lines.length === 0) throw new Error("The chosen assemblies have no items to copy.")
    const costItems = await db
      .select()
      .from(projectEstimateLineCostItems)
      .where(and(
        eq(projectEstimateLineCostItems.estimateId, sourceEstimate.id),
        inArray(projectEstimateLineCostItems.estimateLineId, lines.map((line) => line.id)),
        isNull(projectEstimateLineCostItems.deletedAt),
      ))

    // The estimate that receives the copy.
    let targetEstimateId = input.targetEstimateId
    let createdDraftId: string | null = null
    if (targetEstimateId) {
      await requireEditableEstimate(db, input.targetProjectId, targetEstimateId)
    } else {
      const options = await getEstimateCopyTarget(input.targetProjectId)
      if ("error" in options) throw new Error(options.error)
      if (options.newDraftBlocked) throw new Error(options.newDraftBlocked)
      const created = await createProjectEstimateDraft(input.targetProjectId)
      if (!created.success) throw new Error(created.error)
      targetEstimateId = created.id
      createdDraftId = created.id
    }
    const targetEstimate = await db
      .select()
      .from(projectEstimates)
      .where(and(eq(projectEstimates.id, targetEstimateId), eq(projectEstimates.projectId, input.targetProjectId)))
      .get()
    if (!targetEstimate) throw new Error("Target estimate not found.")

    const [targetAssemblies, targetLines, targetPhases] = await Promise.all([
      db.select({ sortOrder: projectEstimateAssemblies.sortOrder }).from(projectEstimateAssemblies).where(eq(projectEstimateAssemblies.estimateId, targetEstimate.id)),
      db.select({ sortOrder: projectEstimateLines.sortOrder }).from(projectEstimateLines).where(eq(projectEstimateLines.estimateId, targetEstimate.id)),
      db.select().from(projectEstimateReportPhases).where(eq(projectEstimateReportPhases.estimateId, targetEstimate.id)),
    ])
    const markup = markupBasisPoints(input.markupPercent)
    const now = new Date().toISOString()
    const statements: BatchItem<"sqlite">[] = []

    // Report phases: reuse the target's phase of the same division and name, else add it.
    const phaseIdFor = new Map<string, string>()
    let phaseSort = Math.max(0, ...targetPhases.map((phase) => phase.sortOrder))
    for (const phase of reportPhases) {
      if (!lines.some((line) => line.reportPhaseId === phase.id)) continue
      const existing = targetPhases.find((candidate) => candidate.divisionCode === phase.divisionCode && candidate.name.trim().toLowerCase() === phase.name.trim().toLowerCase())
      if (existing) {
        phaseIdFor.set(phase.id, existing.id)
        continue
      }
      const id = crypto.randomUUID()
      phaseSort += 1
      phaseIdFor.set(phase.id, id)
      statements.push(db.insert(projectEstimateReportPhases).values({
        id,
        projectId: input.targetProjectId,
        estimateId: targetEstimate.id,
        divisionCode: phase.divisionCode,
        name: phase.name,
        description: phase.description,
        itemize: phase.itemize,
        sortOrder: phaseSort,
        createdAt: now,
        updatedAt: now,
      }))
    }

    // Assemblies keep their names; items not in an assembly stay that way.
    const assemblyIdFor = new Map<string, string>()
    let assemblySort = Math.max(0, ...targetAssemblies.map((assembly) => assembly.sortOrder))
    for (const assembly of assemblies) {
      const id = crypto.randomUUID()
      assemblySort += 1
      assemblyIdFor.set(assembly.id, id)
      statements.push(db.insert(projectEstimateAssemblies).values({
        id,
        estimateId: targetEstimate.id,
        name: assembly.name,
        description: assembly.description,
        sortOrder: assemblySort,
        createdAt: now,
        updatedAt: now,
      }))
    }

    const copies = copyEstimateLines({
      lines,
      costItems,
      markup,
      sortOffset: Math.max(0, ...targetLines.map((line) => line.sortOrder)) + 1,
    })
    const sourceLines = new Map(lines.map((line) => [line.id, line]))
    const insertedLines: (typeof projectEstimateLines.$inferSelect)[] = []
    for (const copy of copies) {
      const sourceLine = sourceLines.get(copy.sourceLineId)
      const lineId = crypto.randomUUID()
      const row = {
        ...copy.line,
        id: lineId,
        projectId: input.targetProjectId,
        estimateId: targetEstimate.id,
        assemblyId: sourceLine?.assemblyId ? assemblyIdFor.get(sourceLine.assemblyId) ?? null : null,
        reportPhaseId: sourceLine?.reportPhaseId ? phaseIdFor.get(sourceLine.reportPhaseId) ?? null : null,
        createdAt: now,
        updatedAt: now,
      }
      insertedLines.push(row)
      statements.push(db.insert(projectEstimateLines).values(row))
      for (const item of copy.costItems) {
        statements.push(db.insert(projectEstimateLineCostItems).values({
          ...item,
          id: crypto.randomUUID(),
          projectId: input.targetProjectId,
          estimateId: targetEstimate.id,
          estimateLineId: lineId,
          createdAt: now,
          updatedAt: now,
        }))
      }
    }

    // Totals at the target estimate's own builder-fee rates.
    const existingLines = await db.select().from(projectEstimateLines).where(eq(projectEstimateLines.estimateId, targetEstimate.id))
    statements.push(db
      .update(projectEstimates)
      .set({ ...estimateTotalsForLines(targetEstimate, [...existingLines, ...insertedLines]), updatedAt: now })
      .where(eq(projectEstimates.id, targetEstimate.id)))

    // Where each assembly went, shown on the source estimate.
    const groups: readonly { readonly id: string | null; readonly name: string }[] = [
      ...assemblies.map((assembly) => ({ id: assembly.id, name: assembly.name })),
      ...(wantsUnassigned ? [{ id: null, name: UNASSIGNED_NAME }] : []),
    ]
    for (const group of groups) {
      statements.push(db.insert(projectEstimateAssemblyCopies).values({
        id: crypto.randomUUID(),
        organizationId: source.organizationId,
        sourceProjectId: input.sourceProjectId,
        sourceEstimateId: sourceEstimate.id,
        sourceAssemblyId: group.id,
        assemblyName: group.name,
        targetProjectId: input.targetProjectId,
        targetEstimateId: targetEstimate.id,
        targetEstimateNumber: targetEstimate.estimateNumber,
        lineCount: lines.filter((line) => line.assemblyId === group.id).length,
        markupRateBasisPoints: markup,
        createdBy: target.user.id,
        createdAt: now,
      }))
    }

    // Link the jobs so both show it under Linked jobs.
    const link = await db
      .select({ id: projectLinks.id })
      .from(projectLinks)
      .where(or(
        and(eq(projectLinks.projectId, input.sourceProjectId), eq(projectLinks.linkedProjectId, input.targetProjectId)),
        and(eq(projectLinks.projectId, input.targetProjectId), eq(projectLinks.linkedProjectId, input.sourceProjectId)),
      ))
      .get()
    if (!link) {
      statements.push(db.insert(projectLinks).values({
        id: crypto.randomUUID(),
        organizationId: source.organizationId,
        projectId: input.sourceProjectId,
        linkedProjectId: input.targetProjectId,
        label: "Estimate items copied",
        createdBy: target.user.id,
        createdAt: now,
      }).onConflictDoNothing())
    }

    const [first, ...rest] = statements
    if (!first) throw new Error("Nothing to copy.")
    try {
      await db.batch([first, ...rest])
    } catch (error) {
      // Don't leave an empty draft behind; the batch itself is all or nothing.
      if (createdDraftId) await db.delete(projectEstimates).where(eq(projectEstimates.id, createdDraftId)).run()
      throw error
    }

    const names = groups.map((group) => group.name).join(", ")
    const pricing = markup === null ? "source markup kept" : `markup ${markup / 100}%`
    const sourceLabel = source.projectNumber ?? source.projectName
    const targetLabel = target.projectNumber ?? target.projectName
    await Promise.all([
      recordActivityEvent({
        db,
        organizationId: source.organizationId,
        projectId: input.sourceProjectId,
        actor: target.user,
        category: "financial",
        action: "estimate_assemblies_copied_out",
        entityType: "project_estimate",
        entityId: sourceEstimate.id,
        summary: `Copied ${names} from ${sourceEstimate.estimateNumber} to ${targetLabel} estimate ${targetEstimate.estimateNumber}. This estimate was not changed.`,
        metadata: { targetProjectId: input.targetProjectId, targetEstimateId: targetEstimate.id, lineCount: lines.length },
      }),
      recordActivityEvent({
        db,
        organizationId: source.organizationId,
        projectId: input.targetProjectId,
        actor: target.user,
        category: "financial",
        action: "estimate_assemblies_copied_in",
        entityType: "project_estimate",
        entityId: targetEstimate.id,
        summary: `Added ${names} (${lines.length} ${lines.length === 1 ? "item" : "items"}, ${pricing}) to ${targetEstimate.estimateNumber}, copied from ${sourceLabel} estimate ${sourceEstimate.estimateNumber}.`,
        metadata: { sourceProjectId: input.sourceProjectId, sourceEstimateId: sourceEstimate.id, lineCount: lines.length },
      }),
    ])
    revalidateEstimate(input.sourceProjectId)
    revalidateEstimate(input.targetProjectId)
    revalidatePath(`/dashboard/projects/${input.sourceProjectId}`)
    revalidatePath(`/dashboard/projects/${input.targetProjectId}`)
    return { success: true, projectId: input.targetProjectId, estimateId: targetEstimate.id, estimateNumber: targetEstimate.estimateNumber }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to copy to that job." }
  }
}
