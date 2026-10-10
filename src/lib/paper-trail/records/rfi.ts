import { eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectRfis } from "@/db/schema"
import type { LoadedPaperTrailRecord } from "@/lib/paper-trail/types"

export async function loadRfiRecord(
  db: ReturnType<typeof getDb>,
  recordId: string,
): Promise<LoadedPaperTrailRecord | null> {
  const [rfi] = await db
    .select({ projectId: projectRfis.projectId, number: projectRfis.rfiNumber, subject: projectRfis.subject, updatedAt: projectRfis.updatedAt })
    .from(projectRfis)
    .where(eq(projectRfis.id, recordId))
    .limit(1)
  if (!rfi) return null
  const number = rfi.number?.trim() || "Unnumbered"
  return {
    projectId: rfi.projectId,
    // The RFI report shows only the RFI's own fields.
    version: rfi.updatedAt,
    fileBaseName: `RFI ${number} - ${rfi.subject}`,
  }
}
