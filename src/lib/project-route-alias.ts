import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectRouteAliases } from "@/db/schema"

type Db = ReturnType<typeof getDb>

export async function getProjectRouteAliasTarget(
  db: Db,
  sourceProjectId: string,
): Promise<string | null> {
  const alias = await db
    .select({ targetProjectId: projectRouteAliases.targetProjectId })
    .from(projectRouteAliases)
    .where(eq(projectRouteAliases.sourceProjectId, sourceProjectId))
    .limit(1)
    .get()

  return alias?.targetProjectId ?? null
}

export function projectRouteAliasDestination(targetProjectId: string): string {
  return `/dashboard/projects/${encodeURIComponent(targetProjectId)}/information`
}
