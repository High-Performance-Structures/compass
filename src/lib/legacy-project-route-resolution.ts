import { notFound, redirect } from "next/navigation"

import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  legacyProjectFallbackPathname,
  normalizedLegacyProjectId,
  scalarLegacyRouteSearchParam,
} from "@/lib/legacy-project-route"
import { getProjectAccessRecord } from "@/lib/project-access"
import {
  projectRouteAliasDestination,
  resolveProjectRouteAliasTarget,
} from "@/lib/project-route-alias"

type LegacyProjectRouteSearchParams = Readonly<{
  readonly sourceProjectId?: string | readonly string[]
  readonly suffix?: string | readonly string[]
  readonly originalSearch?: string | readonly string[]
}>

/**
 * Resolve a Buildertrend route before any dashboard client shell is mounted.
 * Keeping this boundary at the root avoids reconciling the dashboard layout
 * with a transient resolver child during a client-side navigation.
 */
export async function resolveLegacyProjectRoute(
  searchParams: LegacyProjectRouteSearchParams,
): Promise<never> {
  const sourceProjectId = scalarLegacyRouteSearchParam(
    searchParams.sourceProjectId,
  )
  const suffix = scalarLegacyRouteSearchParam(searchParams.suffix)
  const originalSearch = scalarLegacyRouteSearchParam(
    searchParams.originalSearch,
  )
  const normalizedSourceId = sourceProjectId
    ? normalizedLegacyProjectId(sourceProjectId)
    : null
  if (!normalizedSourceId) notFound()

  const currentUser = await getCurrentUser()
  if (!currentUser) notFound()

  const fallbackPathname = legacyProjectFallbackPathname(
    normalizedSourceId,
    suffix,
    originalSearch,
  )
  if (!fallbackPathname) notFound()

  let aliasResolution: Awaited<ReturnType<typeof resolveProjectRouteAliasTarget>> = {
    kind: "none",
  }
  let hasTargetAccess = false
  try {
    const { env } = await getCloudflareContext()
    if (env?.DB) {
      const db = getDb(env.DB)
      aliasResolution = await resolveProjectRouteAliasTarget(db, normalizedSourceId)
      hasTargetAccess =
        aliasResolution.kind === "resolved"
          ? Boolean(
              await getProjectAccessRecord(
                db,
                currentUser,
                aliasResolution.targetProjectId,
              ),
            )
          : false
    }
  } catch (error) {
    // An additive-migration deployment race or transient lookup failure must
    // not turn every unconsolidated legacy lead into a server error.
    console.warn("[project-route-alias] resolver lookup unavailable", error)
  }

  if (aliasResolution.kind === "cycle") notFound()

  if (aliasResolution.kind === "resolved") {
    if (!hasTargetAccess) notFound()
    redirect(
      projectRouteAliasDestination(
        aliasResolution.targetProjectId,
        suffix,
        originalSearch,
      ),
    )
  }

  // Existing, unconsolidated Buildertrend leads continue through their
  // original project route. The marker prevents a resolver loop.
  redirect(fallbackPathname)
}
