"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { asc, eq } from "drizzle-orm"
import { requireAuth } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"

export type ProjectListItem = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly clientName: string | null
  readonly createdAt: string
}

export async function getProjects(): Promise<ProjectListItem[]> {
  try {
    const user = await requireAuth()
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)
    const allProjects = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        clientName: projects.clientName,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.organizationId, orgId))
      .orderBy(asc(projects.projectNumber), asc(projects.name))

    return allProjects
  } catch {
    return []
  }
}
