import { decodedLegacyProjectId } from "@/lib/legacy-project-route"
import { notFound } from "next/navigation"
import { getDb } from "@/db"
import { getCloudflareContext } from "@/lib/db"
import {
  resolveProjectRouteAliasChain,
  resolveProjectRouteAliasTarget,
  type ProjectRouteAliasLookup,
} from "@/lib/project-route-alias"

/** Decode only the encoded Buildertrend lead ID shape used by project routes. */
export function decodeProjectRouteId(value: string): string {
  return decodedLegacyProjectId(value) ?? value
}

/**
 * Resolve a route ID before handing it to a server action. Alias lookup is
 * deliberately kept here, at the request boundary, so existing authorization
 * checks still run against the canonical project ID.
 *
 * A missing alias table during an additive deployment is treated as a lookup
 * miss for backwards compatibility. Cycles fail closed with `null`.
 */
export async function resolveProjectRouteId(
  value: string,
): Promise<string | null> {
  const projectId = decodeProjectRouteId(value)
  try {
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const resolution = await resolveProjectRouteAliasTarget(db, projectId)
    if (resolution.kind === "cycle") return null
    return resolution.kind === "resolved"
      ? resolution.targetProjectId
      : projectId
  } catch {
    return projectId
  }
}

/** Pure lookup-injected form used by route tests and non-Cloudflare callers. */
export async function resolveProjectRouteIdWithLookup(
  value: string,
  lookup: ProjectRouteAliasLookup,
): Promise<string | null> {
  const projectId = decodeProjectRouteId(value)
  const resolution = await resolveProjectRouteAliasChain(projectId, lookup)
  if (resolution.kind === "cycle") return null
  return resolution.kind === "resolved" ? resolution.targetProjectId : projectId
}

/** Resolve a page route or terminate with a framework 404 on an alias cycle. */
export async function requireProjectRouteId(value: string): Promise<string> {
  const projectId = await resolveProjectRouteId(value)
  if (!projectId) notFound()
  return projectId
}
