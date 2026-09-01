export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { notFound, redirect } from "next/navigation"
import { headers } from "next/headers"

import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  decodedLegacyProjectId,
  legacyProjectDeepLinkFromRequestUrl,
} from "@/lib/legacy-project-route"
import { getProjectAccessRecord } from "@/lib/project-access"
import {
  projectRouteAliasDestination,
  resolveProjectRouteAliasTarget,
} from "@/lib/project-route-alias"

export default async function ProjectRouteAliasLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ id: string }>
}>): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const routeId = decodeProjectRouteId(rawProjectId)
  const projectId = decodedLegacyProjectId(routeId) ?? routeId
  const currentUser = await getCurrentUser()
  let aliasResolution: Awaited<ReturnType<typeof resolveProjectRouteAliasTarget>> = {
    kind: "none",
  }
  let hasTargetAccess = false

  try {
    const { env } = await getCloudflareContext()
    if (env?.DB) {
      const db = getDb(env.DB)
      aliasResolution = await resolveProjectRouteAliasTarget(db, projectId)
      hasTargetAccess =
        aliasResolution.kind === "resolved" && currentUser
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
    // Deploying the app before the additive migration must not break projects.
    console.warn("[project-route-alias] lookup unavailable", error)
  }

  if (aliasResolution.kind === "cycle") notFound()

  if (aliasResolution.kind === "resolved") {
    if (!currentUser || !hasTargetAccess) notFound()
    // AuthKit replaces any client-provided x-url with the actual request URL.
    // Preserve a marker-bearing legacy deep link if it reaches this defensive
    // layout path instead of the normal pre-page resolver.
    const requestHeaders = await headers()
    const deepLink = legacyProjectDeepLinkFromRequestUrl(
      requestHeaders.get("x-url"),
      projectId,
    )
    redirect(
      projectRouteAliasDestination(
        aliasResolution.targetProjectId,
        deepLink?.suffix,
        deepLink?.originalSearch,
      ),
    )
  }

  return <>{children}</>
}
