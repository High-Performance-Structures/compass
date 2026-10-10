import { count, eq, max } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectEstimateLines, projectEstimates } from "@/db/schema-estimates"
import type { LoadedPaperTrailRecord } from "@/lib/paper-trail/types"

export async function loadEstimateRecord(
  db: ReturnType<typeof getDb>,
  recordId: string,
): Promise<LoadedPaperTrailRecord | null> {
  const [estimate] = await db
    .select({
      projectId: projectEstimates.projectId,
      number: projectEstimates.estimateNumber,
      versionNumber: projectEstimates.versionNumber,
      title: projectEstimates.title,
      updatedAt: projectEstimates.updatedAt,
    })
    .from(projectEstimates)
    .where(eq(projectEstimates.id, recordId))
    .limit(1)
  if (!estimate) return null
  const [lines] = await db
    .select({ latest: max(projectEstimateLines.updatedAt), count: count() })
    .from(projectEstimateLines)
    .where(eq(projectEstimateLines.estimateId, recordId))
  const number = `${estimate.number} v${estimate.versionNumber}`
  return {
    projectId: estimate.projectId,
    version: [estimate.updatedAt, lines?.count ?? 0, lines?.latest ?? ""].join("|"),
    fileBaseName: `Estimate ${number}${estimate.title ? ` - ${estimate.title}` : ""}`,
  }
}
