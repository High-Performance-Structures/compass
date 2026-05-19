export const dynamic = "force-dynamic"

import { asc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { ProjectsHub } from "@/components/projects/projects-hub"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { canManageProjectRegistry } from "@/lib/permissions"

export type ProjectsHubProject = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
  readonly status: string
  readonly address: string | null
  readonly clientName: string | null
  readonly projectManager: string | null
  readonly sageJobNumber: string | null
  readonly googleDriveFolderId: string | null
  readonly createdAt: string
}

export default async function ProjectsPage(): Promise<React.ReactElement> {
  let hubProjects: ProjectsHubProject[] = []
  let canCreateOrUpdateProjects = false

  try {
    const currentUser = await getCurrentUser()
    canCreateOrUpdateProjects = canManageProjectRegistry(currentUser)

    const { env } = await getCloudflareContext()
    if (!env?.DB) throw new Error("D1 not available")

    const db = getDb(env.DB)
    const organizationId = currentUser?.organizationId ?? null

    const query = db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        name: projects.name,
        status: projects.status,
        address: projects.address,
        clientName: projects.clientName,
        projectManager: projects.projectManager,
        sageJobNumber: projects.sageJobNumber,
        googleDriveFolderId: projects.googleDriveFolderId,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .orderBy(asc(projects.projectNumber), asc(projects.name))

    hubProjects = organizationId
      ? await query.where(eq(projects.organizationId, organizationId))
      : await query
  } catch (error) {
    console.warn("Project hub unavailable", error)
  }

  return (
    <ProjectsHub
      projects={hubProjects}
      canCreateOrUpdateProjects={canCreateOrUpdateProjects}
    />
  )
}
