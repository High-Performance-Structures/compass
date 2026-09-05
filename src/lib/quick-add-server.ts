import { and, eq, inArray, sql } from "drizzle-orm"

import type { ProjectListItem } from "@/app/actions/projects"
import { getDb } from "@/db"
import {
  organizationMembers,
  organizations,
  projectAccessInvitations,
  projectContacts,
  projectMembers,
  projects,
} from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { isCorrespondenceEnabled } from "@/lib/correspondence/access"
import { chunkD1Values } from "@/lib/d1-query"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { canFeature } from "@/lib/permission-enforcement"
import { can } from "@/lib/permissions"
import {
  type QuickAddAction,
  type QuickAddDestination,
  type QuickAddProject,
  type QuickAddWorkspace,
  quickAddHref,
} from "@/lib/quick-add"
import {
  canUseOrganizationProjectScopeRole,
  isInternalStaffRole,
} from "@/lib/user-roles"

type AccessRow = {
  readonly projectId: string
  readonly organizationId: string | null
  readonly organizationType: string
  readonly organizationRole: string | null
  readonly projectRole: string | null
}

type InternalCapabilities = {
  readonly dailyLog: boolean
  readonly todo: boolean
  readonly scheduleItem: boolean
  readonly rfi: boolean
}

function workspaceFor(row: AccessRow): QuickAddWorkspace | null {
  const staff =
    row.organizationType === "internal" &&
    row.organizationRole !== null &&
    isInternalStaffRole(row.organizationRole)
  if (staff) return "staff"
  if (row.projectRole === "client" || row.projectRole === "owner") return "owner"
  if (row.projectRole === "subcontractor" || row.projectRole === "supplier") {
    return "sub_vendor"
  }
  return null
}

function hasProjectAccess(user: AuthUser, row: AccessRow): boolean {
  return (
    (row.organizationId !== null &&
      user.organizationId === row.organizationId &&
      user.organizationType === "internal" &&
      canUseOrganizationProjectScopeRole(user.role)) ||
    row.projectRole !== null
  )
}

function canUseNativeProjectActions(
  user: AuthUser,
  row: AccessRow,
  workspace: QuickAddWorkspace | null,
): boolean {
  return (
    workspace === "staff" &&
    row.organizationId !== null &&
    user.organizationId === row.organizationId &&
    user.organizationType === "internal" &&
    isInternalStaffRole(user.role)
  )
}

function destination(
  action: QuickAddAction,
  projectId: string,
  workspace: QuickAddWorkspace,
): QuickAddDestination {
  return { action, href: quickAddHref(action, projectId, workspace) }
}

async function internalCapabilities(user: AuthUser): Promise<InternalCapabilities> {
  if (user.organizationType !== "internal" || !isInternalStaffRole(user.role)) {
    return { dailyLog: false, todo: false, scheduleItem: false, rfi: false }
  }
  const [dailyLog, todo, scheduleFeature, rfi] = await Promise.all([
    canFeature(user, "daily-logs", "update"),
    canFeature(user, "tasks", "update"),
    canFeature(user, "schedule", "update"),
    canFeature(user, "rfis", "update"),
  ])
  return {
    dailyLog,
    todo,
    scheduleItem: scheduleFeature && can(user, "schedule", "update"),
    rfi,
  }
}

async function accessRows(
  db: ReturnType<typeof getDb>,
  userId: string,
  projectIds: readonly string[],
): Promise<readonly AccessRow[]> {
  const rows: AccessRow[] = []
  for (const ids of chunkD1Values(projectIds)) {
    rows.push(
      ...await db
        .select({
          projectId: projects.id,
          organizationId: projects.organizationId,
          organizationType: organizations.type,
          organizationRole: organizationMembers.role,
          projectRole: projectMembers.role,
        })
        .from(projects)
        .innerJoin(organizations, eq(organizations.id, projects.organizationId))
        .leftJoin(
          organizationMembers,
          and(
            eq(organizationMembers.organizationId, projects.organizationId),
            eq(organizationMembers.userId, userId),
          ),
        )
        .leftJoin(
          projectMembers,
          and(
            eq(projectMembers.projectId, projects.id),
            eq(projectMembers.userId, userId),
          ),
        )
        .where(inArray(projects.id, ids)),
    )
  }
  return rows
}

async function subVendorContactProjectIds(
  db: ReturnType<typeof getDb>,
  user: AuthUser,
  projectIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const result = new Set<string>()
  const normalizedEmail = user.email.trim().toLowerCase()
  for (const ids of chunkD1Values(projectIds)) {
    if (normalizedEmail) {
      const emailRows = await db
        .select({ projectId: projectContacts.projectId })
        .from(projectContacts)
        .where(
          and(
            inArray(projectContacts.projectId, ids),
            eq(projectContacts.active, true),
            sql`lower(trim(${projectContacts.email})) = ${normalizedEmail}`,
          ),
        )
      for (const row of emailRows) result.add(row.projectId)
    }
    const invitationRows = await db
      .select({ projectId: projectAccessInvitations.projectId })
      .from(projectAccessInvitations)
      .innerJoin(
        projectContacts,
        and(
          eq(projectContacts.id, projectAccessInvitations.projectContactId),
          eq(projectContacts.projectId, projectAccessInvitations.projectId),
          eq(projectContacts.active, true),
        ),
      )
      .where(
        and(
          inArray(projectAccessInvitations.projectId, ids),
          eq(projectAccessInvitations.acceptedBy, user.id),
          eq(projectAccessInvitations.status, "accepted"),
        ),
      )
    for (const row of invitationRows) result.add(row.projectId)
  }
  return result
}

export async function getQuickAddProjects(
  user: AuthUser | null,
  projectList: readonly ProjectListItem[],
): Promise<readonly QuickAddProject[]> {
  if (
    !user ||
    !user.isActive ||
    !user.organizationId ||
    isDemoUser(user.id) ||
    isDemoOrg(user.organizationId) ||
    projectList.length === 0
  ) {
    return []
  }

  try {
    const { env } = await getCloudflareContext()
    if (!env?.DB) return []
    const db = getDb(env.DB)
    const projectIds = Array.from(new Set(projectList.map((project) => project.id)))
    const [rows, capabilities] = await Promise.all([
      accessRows(db, user.id, projectIds),
      internalCapabilities(user),
    ])
    const accessByProject = new Map(rows.map((row) => [row.projectId, row]))
    const subVendorIds = rows
      .filter((row) => row.projectRole === "subcontractor" || row.projectRole === "supplier")
      .map((row) => row.projectId)
    const contactProjects = subVendorIds.length > 0
      ? await subVendorContactProjectIds(db, user, subVendorIds)
      : new Set<string>()

    return projectList.flatMap((project): QuickAddProject[] => {
      const access = accessByProject.get(project.id)
      if (!access) return []
      const workspace = workspaceFor(access)

      const actions: QuickAddDestination[] = []
      if (
        workspace &&
        access.organizationRole !== null &&
        hasProjectAccess(user, access) &&
        (isCorrespondenceEnabled(project.id, env) || isCorrespondenceEnabled(project.id))
      ) {
        actions.push(destination("message", project.id, workspace))
      }
      if (canUseNativeProjectActions(user, access, workspace)) {
        if (capabilities.dailyLog) actions.push(destination("daily-log", project.id, "staff"))
        if (capabilities.todo) actions.push(destination("todo", project.id, "staff"))
        if (capabilities.scheduleItem) actions.push(destination("schedule-item", project.id, "staff"))
        if (capabilities.rfi) actions.push(destination("rfi", project.id, "staff"))
      } else if (
        (access.projectRole === "subcontractor" || access.projectRole === "supplier") &&
        contactProjects.has(project.id)
      ) {
        actions.push(destination("rfi", project.id, "sub_vendor"))
      }
      return actions.length > 0
        ? [{
            id: project.id,
            name: project.name,
            projectNumber: project.projectNumber,
            actions,
          }]
        : []
    })
  } catch (error) {
    console.warn("[quick-add] Unable to load authorized shortcuts", error)
    return []
  }
}
