"use server"

import { and, eq } from "drizzle-orm"
import { z } from "zod/v4"
import { projectEstimateAssemblies, projectEstimateLines } from "@/db/schema-estimates"
import { recordActivityEvent } from "@/lib/activity-log"
import { estimateAccess, requireEditableEstimate, revalidateEstimate } from "@/lib/estimates/access"
import {
  compareEstimateLineOrder,
  reorderedEstimateLinePositions,
  sameEstimateLineOrder,
  type EstimateLineOrderGroup,
} from "@/lib/estimates/line-order"

type EstimateLineOrderActionResult =
  | { readonly success: true; readonly id: string; readonly updatedAt: string }
  | { readonly success: false; readonly error: string }

const orderInput = z.object({
  group: z.discriminatedUnion("type", [
    z.object({ type: z.literal("division"), divisionCode: z.string().min(1) }),
    z.object({ type: z.literal("assembly"), assemblyId: z.string().min(1).nullable() }),
  ]),
  expectedUpdatedAt: z.string().min(1),
  previousIds: z.array(z.string().min(1)).min(1),
  orderedIds: z.array(z.string().min(1)).min(1),
})

export async function reorderProjectEstimateLines(
  projectId: string,
  estimateId: string,
  input: {
    readonly group: EstimateLineOrderGroup
    readonly expectedUpdatedAt: string
    readonly previousIds: readonly string[]
    readonly orderedIds: readonly string[]
  }
): Promise<EstimateLineOrderActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await requireEditableEstimate(access.db, projectId, estimateId)
    const parsed = orderInput.safeParse(input)
    if (!parsed.success) return { success: false, error: "Invalid estimate item order." }
    const data = parsed.data
    const stale = "The estimate changed. Refresh and try reordering again."
    if (data.expectedUpdatedAt !== estimate.updatedAt) return { success: false, error: stale }
    const lines = await access.db.select({
      id: projectEstimateLines.id, divisionCode: projectEstimateLines.divisionCode,
      assemblyId: projectEstimateLines.assemblyId, costCode: projectEstimateLines.costCode,
      sortOrder: projectEstimateLines.sortOrder,
    }).from(projectEstimateLines).where(and(
      eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.projectId, projectId)
    ))
    const assemblies = await access.db.select({ id: projectEstimateAssemblies.id })
      .from(projectEstimateAssemblies).where(eq(projectEstimateAssemblies.estimateId, estimateId))
    const assemblyIds = new Set(assemblies.map((assembly) => assembly.id))
    const group = data.group
    if (group.type === "assembly" && group.assemblyId !== null && !assemblyIds.has(group.assemblyId)) {
      return { success: false, error: "Assembly not found in this estimate." }
    }
    const currentIds = lines.filter((line) => group.type === "division"
      ? line.divisionCode === group.divisionCode
      : group.assemblyId === null
        ? line.assemblyId === null || !assemblyIds.has(line.assemblyId)
        : line.assemblyId === group.assemblyId
    ).sort(compareEstimateLineOrder).map((line) => line.id)
    if (!sameEstimateLineOrder(currentIds, data.previousIds)) return { success: false, error: stale }
    const selected = new Set(data.orderedIds)
    if (selected.size !== currentIds.length || data.orderedIds.length !== currentIds.length ||
        currentIds.some((id) => !selected.has(id))) {
      return { success: false, error: "Reorder only the existing items within this division or assembly." }
    }
    if (sameEstimateLineOrder(currentIds, data.orderedIds)) {
      return { success: true, id: estimateId, updatedAt: estimate.updatedAt }
    }
    const now = new Date(Math.max(Date.now(), (Date.parse(estimate.updatedAt) || 0) + 1)).toISOString()
    const positions = reorderedEstimateLinePositions(lines, data.orderedIds)
    const writes: D1PreparedStatement[] = []
    // Each statement stays below D1's parameter limit. The batch is atomic;
    // the timestamp/status guard prevents a stale save or a newly locked estimate
    // from being overwritten between the read and the write.
    for (let offset = 0; offset < positions.length; offset += 25) {
      const chunk = positions.slice(offset, offset + 25)
      writes.push(access.rawDb.prepare(`UPDATE project_estimate_lines
        SET sort_order = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END, updated_at = ?
        WHERE id IN (${chunk.map(() => "?").join(",")}) AND estimate_id = ? AND project_id = ?
        AND EXISTS (SELECT 1 FROM project_estimates WHERE id = ? AND project_id = ?
          AND updated_at = ? AND status IN ('draft', 'internal_review'))`)
        .bind(...chunk.flatMap((position) => [position.id, position.sortOrder]), now,
          ...chunk.map((position) => position.id), estimateId, projectId,
          estimateId, projectId, estimate.updatedAt))
    }
    writes.push(access.rawDb.prepare(`UPDATE project_estimates SET updated_at = ?,
      foxit_status = 'not_started', foxit_envelope_id = NULL, foxit_embedded_session_url = NULL,
      foxit_prepared_source_hash = NULL, foxit_prepared_at = NULL
      WHERE id = ? AND project_id = ? AND updated_at = ? AND status IN ('draft', 'internal_review')`)
      .bind(now, estimateId, projectId, estimate.updatedAt))
    const results = await access.rawDb.batch(writes)
    if (results.at(-1)?.meta.changes !== 1) return { success: false, error: stale }
    if (access.organizationId) await recordActivityEvent({
      db: access.db, organizationId: access.organizationId, projectId, actor: access.user,
      category: "financial", action: "estimate_items_reordered", entityType: "project_estimate",
      entityId: estimateId, summary: "Reordered estimate items.",
      metadata: { groupType: group.type, groupId: group.type === "division" ? group.divisionCode : group.assemblyId, previousOrder: JSON.stringify(currentIds), savedOrder: JSON.stringify(data.orderedIds) }, createdAt: now,
    })
    revalidateEstimate(projectId)
    return { success: true, id: estimateId, updatedAt: now }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to reorder estimate items." }
  }
}
