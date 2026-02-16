"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { asc, eq } from "drizzle-orm"
import { requireAuth } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"

export async function getProjects(): Promise<{ id: string; name: string }[]> {
  try {
    const user = await requireAuth()
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)
    const allProjects = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.organizationId, orgId))
      .orderBy(asc(projects.name))

    return allProjects
  } catch {
    return []
  }
}
