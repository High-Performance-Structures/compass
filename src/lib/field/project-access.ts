import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { projectMembers } from "@/db/schema"

export async function assertFieldProjectMembership(
  db: ReturnType<typeof getDb>,
  userId: string,
  projectId: string
): Promise<void> {
  const membership = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.userId, userId),
        eq(projectMembers.projectId, projectId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!membership) {
    throw new Error("This project is not assigned to your Field account.")
  }
}
