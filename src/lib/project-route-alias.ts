import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectRouteAliases } from "@/db/schema"
import { isSafeLegacyProjectSuffix } from "@/lib/legacy-project-route"

type Db = ReturnType<typeof getDb>

const MAX_PROJECT_ROUTE_ALIAS_HOPS = 16

export type ProjectRouteAliasResolution =
  | { readonly kind: "none" }
  | { readonly kind: "resolved"; readonly targetProjectId: string }
  | { readonly kind: "cycle" }

export type ProjectRouteAliasLookup = (
  sourceProjectId: string,
) => Promise<string | null>

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

export async function resolveProjectRouteAliasChain(
  sourceProjectId: string,
  lookup: ProjectRouteAliasLookup,
): Promise<ProjectRouteAliasResolution> {
  const visited = new Set<string>()
  let currentProjectId = sourceProjectId

  for (let hop = 0; hop <= MAX_PROJECT_ROUTE_ALIAS_HOPS; hop += 1) {
    if (visited.has(currentProjectId)) return { kind: "cycle" }
    visited.add(currentProjectId)

    const targetProjectId = await lookup(currentProjectId)
    if (!targetProjectId) {
      return currentProjectId === sourceProjectId
        ? { kind: "none" }
        : { kind: "resolved", targetProjectId: currentProjectId }
    }

    currentProjectId = targetProjectId
  }

  return { kind: "cycle" }
}

export function resolveProjectRouteAliasTarget(
  db: Db,
  sourceProjectId: string,
): Promise<ProjectRouteAliasResolution> {
  return resolveProjectRouteAliasChain(sourceProjectId, (projectId) =>
    getProjectRouteAliasTarget(db, projectId),
  )
}

export function projectRouteAliasDestination(
  targetProjectId: string,
  suffix?: string,
  originalSearch?: string,
): string {
  const safeSuffix =
    suffix && isSafeLegacyProjectSuffix(suffix)
      ? suffix
      : "/information"
  const search = new URLSearchParams(originalSearch ?? "")
  search.delete("legacyResolved")
  const renderedSearch = search.toString()
  return `/dashboard/projects/${encodeURIComponent(targetProjectId)}${safeSuffix}${renderedSearch ? `?${renderedSearch}` : ""}`
}
