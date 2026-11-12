import { and, eq, inArray, sql } from "drizzle-orm"

import type { ProjectListItem } from "@/lib/projects/project-list"
import { getDb } from "@/db"
import {
  projectContacts,
  projects,
} from "@/db/schema"
import { companiesView, invitationsView, membershipsView } from "@/lib/domain/identity/views"
import { projectMembersView } from "@/lib/domain/project/views"
import type { AuthUser } from "@/lib/auth"
import { changeOrderRequesterType } from "@/lib/change-orders/access"
import { isWarrantyProjectStage } from "@/lib/warranty/status"
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
  isOwnerRole,
  isVendorRole,
} from "@/lib/user-roles"
import { resolvedContactColumns, withContactDirectory } from "@/lib/domain/contacts/resolved-columns"

const memberships = membershipsView()
const companies = companiesView()
const invitations = invitationsView()
const projectMemberships = projectMembersView()

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
  readonly purchaseOrder: boolean
  readonly rfq: boolean
}

function workspaceFor(row: AccessRow): QuickAddWorkspace | null {
  const staff =
    row.organizationType === "internal" &&
    row.organizationRole !== null &&
    isInternalStaffRole(row.organizationRole)
  if (staff) return "staff"
  if (isOwnerRole(row.projectRole)) return "owner"
  if (isVendorRole(row.projectRole)) {
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
    return { dailyLog: false, todo: false, scheduleItem: false, rfi: false, purchaseOrder: false, rfq: false }
  }
  const [dailyLog, todo, scheduleFeature, rfi, purchaseOrder, rfq] = await Promise.all([
    canFeature(user, "daily-logs", "update"),
    canFeature(user, "tasks", "update"),
    canFeature(user, "schedule", "update"),
    canFeature(user, "rfis", "update"),
    canFeature(user, "purchase-orders", "update"),
    canFeature(user, "rfqs", "update"),
  ])
  return {
    dailyLog,
    todo,
    scheduleItem: scheduleFeature && can(user, "schedule", "update"),
    rfi,
    purchaseOrder,
    rfq,
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
          organizationType: companies.type,
          organizationRole: memberships.role,
          projectRole: projectMemberships.role,
        })
        .from(projects)
        .innerJoin(companies, eq(companies.id, projects.organizationId))
        .leftJoin(
          memberships,
          and(
            eq(memberships.organizationId, projects.organizationId),
            eq(memberships.userId, userId),
          ),
        )
        .leftJoin(
          projectMemberships,
          and(
            eq(projectMemberships.projectId, projects.id),
            eq(projectMemberships.userId, userId),
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
      const emailRows = await withContactDirectory(db
        .select({ projectId: projectContacts.projectId })
        .from(projectContacts)
        .where(
          and(
            inArray(projectContacts.projectId, ids),
            eq(projectContacts.active, true),
            sql`lower(${resolvedContactColumns.email}) = ${normalizedEmail}`,
          ),
        ).$dynamic())
      for (const row of emailRows) result.add(row.projectId)
    }
    const invitationRows = await db
      .select({ projectId: invitations.projectId })
      .from(invitations)
      .innerJoin(
        projectContacts,
        and(
          eq(projectContacts.id, invitations.projectContactId),
          eq(projectContacts.projectId, invitations.projectId),
          eq(projectContacts.active, true),
        ),
      )
      .where(
        and(
          inArray(invitations.projectId, ids),
          eq(invitations.acceptedBy, user.id),
          eq(invitations.status, "accepted"),
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
    const [rows, capabilities, changeRequestRead, changeRequestCreate] = await Promise.all([
      accessRows(db, user.id, projectIds),
      internalCapabilities(user),
      canFeature(user, "change-orders", "read"),
      canFeature(user, "change-orders", "create"),
    ])
    const accessByProject = new Map(rows.map((row) => [row.projectId, row]))
    const subVendorIds = rows
      .filter((row) => isVendorRole(row.projectRole))
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
        if (capabilities.purchaseOrder) actions.push(destination("purchase-order", project.id, "staff"))
        if (capabilities.rfq) actions.push(destination("rfq", project.id, "staff"))
      } else if (
        (isVendorRole(access.projectRole)) &&
        contactProjects.has(project.id)
      ) {
        actions.push(destination("rfi", project.id, "sub_vendor"))
      }
      // Match the external forms; staff previews must remain read-only.
      if (
        workspace &&
        workspace !== "staff" &&
        !isInternalStaffRole(user.role) &&
        hasProjectAccess(user, access)
      ) {
        if (
          changeRequestRead &&
          changeRequestCreate &&
          changeOrderRequesterType({
            internal: false,
            projectRole: access.projectRole,
          })
        ) {
          actions.push(destination("change-request", project.id, workspace))
        }
        if (workspace === "owner" && isWarrantyProjectStage(project)) {
          actions.push(destination("warranty-request", project.id, workspace))
        }
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
