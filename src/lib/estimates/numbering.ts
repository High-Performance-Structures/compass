import { and, desc, eq, isNull } from "drizzle-orm"

import { projectEstimates } from "@/db/schema-estimates"
import type { CompassDb } from "@/lib/estimates/access"
import { estimateModeFor, nextEstimateNumber, type EstimateMode } from "@/lib/estimates/estimate-modes"
import { readFeatureSettings } from "@/lib/feature-settings/server"

/** The company's estimate mode for a department; "single" if settings can't be read. */
export async function readEstimateMode(db: CompassDb, organizationId: string | null, department: string | null): Promise<EstimateMode> {
  if (!organizationId) return estimateModeFor(department, {})
  try {
    const settings = await readFeatureSettings(db, organizationId, "estimates")
    return estimateModeFor(department, settings.modes)
  } catch {
    return estimateModeFor(department, {})
  }
}

/**
 * Number and version for a brand-new estimate on a job. One-estimate
 * departments keep the job's number and take the next version; departments
 * with several estimates start a new number at version 1.
 */
export async function numberNewEstimate(
  db: CompassDb,
  input: { readonly projectId: string; readonly projectNumber: string | null; readonly mode: EstimateMode },
): Promise<{ readonly estimateNumber: string; readonly versionNumber: number }> {
  const rows = await db
    .select({ estimateNumber: projectEstimates.estimateNumber, versionNumber: projectEstimates.versionNumber })
    .from(projectEstimates)
    // Change-order estimates are numbered after their change order.
    .where(and(eq(projectEstimates.projectId, input.projectId), isNull(projectEstimates.changeOrderId)))
    .orderBy(desc(projectEstimates.versionNumber))
  if (input.mode === "multiple") {
    return { estimateNumber: nextEstimateNumber(input.projectNumber, rows.map((row) => row.estimateNumber)), versionNumber: 1 }
  }
  return { estimateNumber: `${input.projectNumber ?? "PROJECT"}-00`, versionNumber: (rows[0]?.versionNumber ?? 0) + 1 }
}
