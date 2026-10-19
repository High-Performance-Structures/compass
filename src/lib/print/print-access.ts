import { eq } from "drizzle-orm"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"

export type PrintProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly department: string | null
  readonly address: string | null
  readonly clientName: string | null
}

/**
 * Print pages check the viewer can read the project, then load the record.
 * Record loaders that take a db (the paper trail's) run only after this.
 */
export async function printProjectAccess(projectId: string): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly project: PrintProject
}> {
  const user = await requireAuth()
  requirePermission(user, "project", "read")
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectAccess(db, user, projectId)
  const project = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      department: projects.department,
      address: projects.address,
      clientName: projects.clientName,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!project) throw new Error("Project not found")
  return { db, project }
}
