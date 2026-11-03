import { and, asc, eq } from "drizzle-orm"
import { cache } from "react"

import { getDb } from "@/db"
import { projectJobStatuses, projectMembers, projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { linkedProjectClientName } from "@/lib/domain/contacts/directory-links"
import { requirePermission } from "@/lib/permissions"
import { projectJobStatusLabel } from "@/lib/project-profile"
import { activeRegistryProject } from "@/lib/project-registry-visibility"
import { canUseOrganizationProjectScopeRole } from "@/lib/user-roles"

export type ProjectListItem = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly clientName: string | null
  readonly googleDriveFolderId: string | null
  readonly status: string
  readonly clientStatus: string
  readonly jobStatusId: string
  readonly jobStatusLabel: string
  /** Listed under the Internal department on the Project Hub. */
  readonly internalDepartment: boolean
  readonly createdAt: string
}

type ProjectListRow = Omit<ProjectListItem, "jobStatusLabel"> & {
  readonly customJobStatusLabel: string | null
}

export function projectListItems(rows: readonly ProjectListRow[]): ProjectListItem[] {
  return rows.map(({ customJobStatusLabel, ...project }) => ({
    ...project,
    jobStatusLabel: projectJobStatusLabel({
      jobStatusId: project.jobStatusId,
      customLabel: customJobStatusLabel,
    }),
  }))
}

/**
 * Layouts, pages, and their helpers often list the viewer's projects several
 * times in one request; memoize per request (React `cache`, like
 * getCurrentUser) so they share one query. The arguments are every identity
 * field the query depends on, so different viewers never share an entry.
 */
export const loadProjectListForRequest = cache(loadProjectList)

async function loadProjectList(
  userId: string,
  organizationId: string | null,
  useOrganizationScope: boolean,
): Promise<ProjectListItem[]> {
  const { env } = await getCloudflareContext()
  if (!env?.DB) return []

  const db = getDb(env.DB)

  if (organizationId && useOrganizationScope) {
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        clientName: linkedProjectClientName,
        googleDriveFolderId: projects.googleDriveFolderId,
        status: projects.status,
        clientStatus: projects.clientStatus,
        jobStatusId: projects.jobStatusId,
        customJobStatusLabel: projectJobStatuses.label,
        internalDepartment: projects.internalDepartment,
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
      .where(
        and(
          eq(projects.organizationId, organizationId),
          activeRegistryProject(db),
        ),
      )
      .orderBy(asc(projects.projectNumber), asc(projects.name))
    return projectListItems(rows)
  }

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      clientName: linkedProjectClientName,
      googleDriveFolderId: projects.googleDriveFolderId,
      status: projects.status,
      clientStatus: projects.clientStatus,
      jobStatusId: projects.jobStatusId,
      customJobStatusLabel: projectJobStatuses.label,
      internalDepartment: projects.internalDepartment,
      createdAt: projects.createdAt,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .leftJoin(
      projectJobStatuses,
      and(
        eq(projectJobStatuses.id, projects.jobStatusId),
        eq(projectJobStatuses.organizationId, projects.organizationId),
      ),
    )
    .where(
      and(
        eq(projectMembers.userId, userId),
        activeRegistryProject(db),
      ),
    )
    .orderBy(asc(projects.projectNumber), asc(projects.name))
  return projectListItems(rows)
}

/**
 * The signed-in viewer's projects: requires project read permission and
 * returns an empty list when the viewer is signed out or not permitted.
 * The getProjects server action and server-side callers share this.
 */
export async function listProjectsForCurrentUser(): Promise<ProjectListItem[]> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "read")
    return await loadProjectListForRequest(
      user.id,
      user.organizationId ?? null,
      user.organizationType === "internal" &&
        canUseOrganizationProjectScopeRole(user.role),
    )
  } catch {
    return []
  }
}
