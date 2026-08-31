export const dynamic = "force-dynamic"

import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { decodedLegacyProjectId } from "@/lib/legacy-project-route"
import { getProjectAccessRecord } from "@/lib/project-access"
import {
  getProjectRouteAliasTarget,
  projectRouteAliasDestination,
} from "@/lib/project-route-alias"
import { redirect } from "next/navigation"

export default async function ProjectRouteAliasLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ id: string }>
}>): Promise<React.ReactElement> {
  const { id: routeId } = await params
  const projectId = decodedLegacyProjectId(routeId) ?? routeId
  const currentUser = await getCurrentUser()
  let targetProjectId: string | null = null

  if (currentUser) {
    try {
      const { env } = await getCloudflareContext()
      if (env?.DB) {
        const db = getDb(env.DB)
        const candidateTarget = await getProjectRouteAliasTarget(db, projectId)
        if (
          candidateTarget &&
          (await getProjectAccessRecord(db, currentUser, candidateTarget))
        ) {
          targetProjectId = candidateTarget
        }
      }
    } catch (error) {
      // Deploying the app before the additive migration must not break projects.
      console.warn("[project-route-alias] lookup unavailable", error)
    }
  }

  if (targetProjectId) {
    redirect(projectRouteAliasDestination(targetProjectId))
  }

  return <>{children}</>
}
