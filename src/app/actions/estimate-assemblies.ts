"use server"

import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod/v4"
import { projectEstimateAssemblies, projectEstimateLines, projectEstimates } from "@/db/schema-estimates"
import { recordActivityEvent } from "@/lib/activity-log"
import { estimateAccess, requireEditableEstimate, revalidateEstimate } from "@/lib/estimates/access"
import type { ProjectEstimateActionResult } from "@/app/actions/project-estimates"

const assemblyInput = z.object({
  name: z.string().trim().min(1, "Enter an assembly name.").max(160),
  description: z.string().trim().max(2000),
  lineIds: z.array(z.string().min(1)).max(1000),
})

export async function saveProjectEstimateAssembly(
  projectId: string,
  estimateId: string,
  assemblyId: string | null,
  input: { readonly name: string; readonly description: string; readonly lineIds: readonly string[] }
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    const parsed = assemblyInput.safeParse(input)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid assembly." }
    const data = parsed.data
    const existingAssemblies = await access.db.select().from(projectEstimateAssemblies)
      .where(eq(projectEstimateAssemblies.estimateId, estimateId))
    const existing = existingAssemblies.find((row) => row.id === assemblyId)
    if (assemblyId && !existing) return { success: false, error: "Assembly not found in this estimate." }
    const lines = await access.db.select({ id: projectEstimateLines.id }).from(projectEstimateLines)
      .where(eq(projectEstimateLines.estimateId, estimateId))
    const availableIds = new Set(lines.map((line) => line.id))
    const selectedIds = [...new Set(data.lineIds)]
    if (selectedIds.some((id) => !availableIds.has(id))) {
      return { success: false, error: "An item is no longer available in this estimate. Refresh and try again." }
    }
    const id = assemblyId ?? crypto.randomUUID()
    const now = new Date().toISOString()
    const values = { name: data.name, description: data.description || null, updatedAt: now }
    const mutation = existing
      ? access.db.update(projectEstimateAssemblies).set(values).where(and(
          eq(projectEstimateAssemblies.id, id), eq(projectEstimateAssemblies.estimateId, estimateId)))
      : access.db.insert(projectEstimateAssemblies).values({
          id, estimateId, ...values, createdAt: now,
          sortOrder: Math.max(-1, ...existingAssemblies.map((row) => row.sortOrder)) + 1,
        })
    const assignments = []
    // D1 limits bind parameters per statement; assigning many items stays atomic
    // by chunking statements inside one batch.
    for (let offset = 0; offset < selectedIds.length; offset += 80) {
      assignments.push(access.db.update(projectEstimateLines).set({ assemblyId: id, updatedAt: now })
        .where(and(eq(projectEstimateLines.estimateId, estimateId), inArray(projectEstimateLines.id, selectedIds.slice(offset, offset + 80)))))
    }
    await access.db.batch([
      mutation,
      access.db.update(projectEstimateLines).set({ assemblyId: null, updatedAt: now })
        .where(and(eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.assemblyId, id))),
      ...assignments,
      access.db.update(projectEstimates).set({ updatedAt: now }).where(eq(projectEstimates.id, estimateId)),
    ])
    if (access.organizationId) await recordActivityEvent({
      db: access.db, organizationId: access.organizationId, projectId, actor: access.user,
      category: "financial", action: existing ? "estimate_assembly_updated" : "estimate_assembly_created",
      entityType: "estimate_assembly", entityId: id, summary: `${existing ? "Updated" : "Created"} estimate assembly: ${data.name}`,
      metadata: { estimateId, itemCount: selectedIds.length },
    })
    revalidateEstimate(projectId)
    return { success: true, id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to save assembly." }
  }
}

export async function deleteProjectEstimateAssembly(
  projectId: string,
  estimateId: string,
  assemblyId: string
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    const rows = await access.db.select().from(projectEstimateAssemblies).where(and(
      eq(projectEstimateAssemblies.id, assemblyId), eq(projectEstimateAssemblies.estimateId, estimateId)))
    const assembly = rows[0]
    if (!assembly) return { success: false, error: "Assembly not found in this estimate." }
    const now = new Date().toISOString()
    await access.db.batch([
      access.db.update(projectEstimateLines).set({ assemblyId: null, updatedAt: now }).where(and(
        eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.assemblyId, assemblyId))),
      access.db.delete(projectEstimateAssemblies).where(and(
        eq(projectEstimateAssemblies.id, assemblyId), eq(projectEstimateAssemblies.estimateId, estimateId))),
      access.db.update(projectEstimates).set({ updatedAt: now }).where(eq(projectEstimates.id, estimateId)),
    ])
    if (access.organizationId) await recordActivityEvent({
      db: access.db, organizationId: access.organizationId, projectId, actor: access.user,
      category: "financial", action: "estimate_assembly_deleted", entityType: "estimate_assembly", entityId: assemblyId,
      summary: `Deleted estimate assembly: ${assembly.name}. Estimate items retained.`, metadata: { estimateId },
    })
    revalidateEstimate(projectId)
    return { success: true, id: assemblyId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to delete assembly." }
  }
}
