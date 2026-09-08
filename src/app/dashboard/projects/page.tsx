export const dynamic = "force-dynamic"

import { and, asc, eq, inArray, notExists } from "drizzle-orm"

import { getDashboardOverview } from "@/app/actions/dashboard-overview"
import {
  getProjectIntakeAssignees,
  getProjects,
} from "@/app/actions/projects"
import { getProjectDuplicateCandidates } from "@/app/actions/project-duplicates"
import { getApprovedProjectNumberReviewKeys } from "@/app/actions/project-number-reviews"
import { getDb } from "@/db"
import {
  projectExternalLinks,
  projectDuplicateDecisions,
  projectJobStatuses,
  projectRegistryRemovals,
  projectRouteAliases,
  projects,
} from "@/db/schema"
import { ProjectsHub } from "@/components/projects/projects-hub"
import { ProjectHubLaunchpad } from "@/components/projects/project-hub-launchpad"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { canFeature } from "@/lib/permission-enforcement"
import {
  canCreateProject,
  canManageProjectRegistry,
} from "@/lib/permissions"
import { projectJobStatusLabel } from "@/lib/project-profile"
import { isDeveloperModeEnabled } from "@/lib/developer-mode-server"

export type ProjectsHubProject = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
  readonly status: string
  readonly clientStatus: string
  readonly jobStatusId: string
  readonly jobStatusLabel: string
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

export default async function ProjectsPage({
  searchParams,
}: {
  readonly searchParams: Promise<
    Record<string, string | readonly string[] | undefined>
  >
}): Promise<React.ReactElement> {
  const params = await searchParams
  const currentUser = await getCurrentUser()
  const canUpdateProjectStatus =
    currentUser !== null &&
    currentUser.organizationId !== null &&
    !isDemoUser(currentUser.id) &&
    !isDemoOrg(currentUser.organizationId) &&
    (await canFeature(currentUser, "project-hub", "update"))
  const canCreateOrUpdateProjects = canManageProjectRegistry(currentUser)
  const developerModeEnabled = await isDeveloperModeEnabled(
    canCreateOrUpdateProjects,
  )
  const showRegistry =
    developerModeEnabled &&
    (params.manage !== undefined ||
      params.department !== undefined ||
      params.status !== undefined)

  if (!showRegistry) {
    const [projectList, overview, intakeAssignees, duplicateCandidates, approvedProjectNumberReviewKeys] = await Promise.all([
      getProjects(),
      getDashboardOverview(),
      getProjectIntakeAssignees(),
      canCreateOrUpdateProjects ? getProjectDuplicateCandidates() : Promise.resolve([]),
      canCreateOrUpdateProjects ? getApprovedProjectNumberReviewKeys() : Promise.resolve([]),
    ])

    return (
      <ProjectHubLaunchpad
        projects={projectList}
        overview={overview}
        canManageProjects={canCreateProject(currentUser)}
        canReviewProjectNumbers={canCreateOrUpdateProjects}
        canUpdateProjectStatus={canUpdateProjectStatus}
        duplicateCandidates={duplicateCandidates}
        approvedProjectNumberReviewKeys={approvedProjectNumberReviewKeys}
        intakeAssignees={intakeAssignees}
      />
    )
  }

  let hubProjects: ProjectsHubProject[] = []

  try {
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
        clientStatus: projects.clientStatus,
        jobStatusId: projects.jobStatusId,
        customJobStatusLabel: projectJobStatuses.label,
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
      .leftJoin(
        projectJobStatuses,
        and(
          eq(projectJobStatuses.id, projects.jobStatusId),
          eq(projectJobStatuses.organizationId, projects.organizationId),
        ),
      )
      .orderBy(asc(projects.projectNumber), asc(projects.name))

    const isActiveRegistryProject = and(
      notExists(
        db
          .select({ sourceProjectId: projectRouteAliases.sourceProjectId })
          .from(projectRouteAliases)
          .where(eq(projectRouteAliases.sourceProjectId, projects.id)),
      ),
      notExists(
        db.select({ projectId: projectRegistryRemovals.projectId }).from(projectRegistryRemovals).where(eq(projectRegistryRemovals.projectId, projects.id)),
      ),
      notExists(
        db
          .select({
            removedProjectId: projectDuplicateDecisions.removedProjectId,
          })
          .from(projectDuplicateDecisions)
          .where(
            and(
              eq(projectDuplicateDecisions.status, "merged"),
              eq(projectDuplicateDecisions.removedProjectId, projects.id),
            ),
          ),
      ),
    )
    const loadedProjects = organizationId
      ? await query.where(
          and(
            eq(projects.organizationId, organizationId),
            isActiveRegistryProject,
          ),
        )
      : await query.where(isActiveRegistryProject)
    hubProjects = loadedProjects.map(({ customJobStatusLabel, ...project }) => ({
      ...project,
      jobStatusLabel: projectJobStatusLabel({
        jobStatusId: project.jobStatusId,
        customLabel: customJobStatusLabel,
      }),
      telegramChatId: null,
    }))

    if (hubProjects.length > 0) {
      const projectIds = hubProjects.map((project) => project.id)
      const telegramLinks: {
        readonly projectId: string
        readonly externalId: string | null
      }[] = []

      // D1 limits bound parameters per statement. Imported organizations can
      // contain hundreds of projects, so resolve external links in safe batches.
      for (let offset = 0; offset < projectIds.length; offset += 75) {
        const projectIdBatch = projectIds.slice(offset, offset + 75)
        const linkBatch = await db
          .select({
            projectId: projectExternalLinks.projectId,
            externalId: projectExternalLinks.externalId,
          })
          .from(projectExternalLinks)
          .where(
            and(
              inArray(projectExternalLinks.projectId, projectIdBatch),
              eq(projectExternalLinks.system, "telegram_owner_updates")
            )
          )
        telegramLinks.push(...linkBatch)
      }

      const telegramLinkByProjectId = new Map(
        telegramLinks.map((link) => [link.projectId, link.externalId])
      )

      hubProjects = hubProjects.map((project) => {
        return {
          ...project,
          telegramChatId: telegramLinkByProjectId.get(project.id) ?? null,
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
