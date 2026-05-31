export const dynamic = "force-dynamic"

import { and, asc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import { projectExternalLinks, projects } from "@/db/schema"
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
  readonly sageJobId: string | null
  readonly sageJobNumber: string | null
  readonly googleDriveFolderId: string | null
  readonly googleScheduleSheetId: string | null
  readonly googleDailyLogSheetId: string | null
  readonly googleCalendarId: string | null
  readonly buildertrendProjectId: string | null
  readonly telegramChatId: string | null
  readonly ownerUpdatesEnabled: boolean
  readonly ownerUpdateChannel: string
  readonly ownerUpdateCadence: string
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
        sageJobId: projects.sageJobId,
        sageJobNumber: projects.sageJobNumber,
        googleDriveFolderId: projects.googleDriveFolderId,
        googleScheduleSheetId: projects.googleScheduleSheetId,
        googleDailyLogSheetId: projects.googleDailyLogSheetId,
        googleCalendarId: projects.googleCalendarId,
        buildertrendProjectId: projects.buildertrendProjectId,
        ownerUpdatesEnabled: projects.ownerUpdatesEnabled,
        ownerUpdateChannel: projects.ownerUpdateChannel,
        ownerUpdateCadence: projects.ownerUpdateCadence,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .orderBy(asc(projects.projectNumber), asc(projects.name))

    const loadedProjects = organizationId
      ? await query.where(eq(projects.organizationId, organizationId))
      : await query
    hubProjects = loadedProjects.map((project) => ({
      ...project,
      telegramChatId: null,
    }))

    if (hubProjects.length > 0) {
      const projectIds = hubProjects.map((project) => project.id)
      const telegramLinks = await db
        .select({
          projectId: projectExternalLinks.projectId,
          externalId: projectExternalLinks.externalId,
        })
        .from(projectExternalLinks)
        .where(
          and(
            inArray(projectExternalLinks.projectId, projectIds),
            eq(projectExternalLinks.system, "telegram_owner_updates")
          )
        )

      hubProjects = hubProjects.map((project) => {
        const telegramLink = telegramLinks.find(
          (link) => link.projectId === project.id
        )

        return {
          ...project,
          telegramChatId: telegramLink?.externalId ?? null,
        }
      })
    }
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
