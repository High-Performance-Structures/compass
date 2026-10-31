import "server-only"

import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { insertProjectProfileSyncOperationStatement } from "@/lib/domain/project/store"

/** Queue one registry/tracker refresh after a project-contact mutation batch. */
export async function queueProjectContactTrackerRefresh(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectId: string
}): Promise<void> {
  const [project] = await input.db
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(
      eq(projects.id, input.projectId),
      eq(projects.organizationId, input.organizationId)
    ))
    .limit(1)
  if (!project?.projectNumber) return

  const now = new Date().toISOString()
  // One statement; the project store only offers the batch form.
  await input.db.batch([insertProjectProfileSyncOperationStatement(input.db, {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    projectId: input.projectId,
    operation: "tracker_row_update",
    status: "pending",
    payloadJson: JSON.stringify({
      previousProjectNumber: project.projectNumber,
      projectNumber: project.projectNumber,
    }),
    error: null,
    attempts: 0,
    attemptedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  })])
}
