"use server"

import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectRoleAssignments, users } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { canManageProjectRegistry, requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import {
  isProjectAssignmentScopeId,
  projectAssignmentScopeLabel,
  type ProjectAssignmentScopeId,
} from "@/lib/project-role-assignments"
import {
  isProjectWorkflowRoleId,
  roleLensForId,
  type ProjectWorkflowRoleId,
} from "@/lib/project-workflow-roles"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ProjectRoleAssignableUser = {
  readonly id: string
  readonly label: string
  readonly email: string
}

export type ProjectRoleAssignmentItem = {
  readonly id: string
  readonly userId: string
  readonly userName: string
  readonly userEmail: string
  readonly roleId: ProjectWorkflowRoleId
  readonly roleLabel: string
  readonly scopeId: ProjectAssignmentScopeId
  readonly scopeLabel: string
  readonly notes: string | null
  readonly assignedAt: string
}

export type ProjectRoleAssignmentSummary = {
  readonly assignments: readonly ProjectRoleAssignmentItem[]
  readonly users: readonly ProjectRoleAssignableUser[]
  readonly canManage: boolean
}

type ProjectRoleAssignmentActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

function displayNameForUser(user: {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string
}): string {
  const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
  return user.displayName ?? (fullName.length > 0 ? fullName : user.email)
}

function normalizeNotes(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

export async function getProjectRoleAssignmentSummary(
  projectId: string,
): Promise<ProjectRoleAssignmentSummary> {
  const user = await requireAuth()
  requirePermission(user, "project", "read")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectAccess(db, user, projectId)

  const canManage = canManageProjectRegistry(user)
  const rows = await db
    .select({
      id: projectRoleAssignments.id,
      userId: users.id,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      roleId: projectRoleAssignments.roleId,
      scopeId: projectRoleAssignments.assignmentScope,
      notes: projectRoleAssignments.notes,
      assignedAt: projectRoleAssignments.assignedAt,
    })
    .from(projectRoleAssignments)
    .innerJoin(users, eq(projectRoleAssignments.userId, users.id))
    .where(
      and(
        eq(projectRoleAssignments.projectId, projectId),
        eq(projectRoleAssignments.isActive, true),
      ),
    )
    .orderBy(
      asc(projectRoleAssignments.assignmentScope),
      asc(projectRoleAssignments.roleId),
      asc(users.displayName),
    )

  const assignments = rows.flatMap((row): readonly ProjectRoleAssignmentItem[] => {
    if (!isProjectWorkflowRoleId(row.roleId)) return []
    if (!isProjectAssignmentScopeId(row.scopeId)) return []

    return [
      {
        id: row.id,
        userId: row.userId,
        userName: displayNameForUser(row),
        userEmail: row.email,
        roleId: row.roleId,
        roleLabel: roleLensForId(row.roleId).label,
        scopeId: row.scopeId,
        scopeLabel: projectAssignmentScopeLabel(row.scopeId),
        notes: row.notes,
        assignedAt: row.assignedAt,
      },
    ]
  })

  const userRows = canManage
    ? await db
        .select({
          id: users.id,
          displayName: users.displayName,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          role: users.role,
        })
        .from(users)
        .where(eq(users.isActive, true))
        .orderBy(asc(users.displayName), asc(users.email))
    : []

  const assignableUsers = userRows
    .filter((row) => isInternalStaffRole(row.role) || row.role === "developer")
    .map((row): ProjectRoleAssignableUser => {
      return {
        id: row.id,
        label: displayNameForUser(row),
        email: row.email,
      }
    })

  return {
    assignments,
    users: assignableUsers,
    canManage,
  }
}

export async function assignProjectRole(input: {
  readonly projectId: string
  readonly userId: string
  readonly roleId: string
  readonly assignmentScope: string
  readonly notes?: string | null
}): Promise<ProjectRoleAssignmentActionResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "update")
    if (!canManageProjectRegistry(user)) {
      return { success: false, error: "Project role assignments are admin-only." }
    }
    if (!isProjectWorkflowRoleId(input.roleId)) {
      return { success: false, error: "Choose a valid project role." }
    }
    if (!isProjectAssignmentScopeId(input.assignmentScope)) {
      return { success: false, error: "Choose a valid assignment scope." }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await assertProjectAccess(db, user, input.projectId)

    const now = new Date().toISOString()
    const notes = normalizeNotes(input.notes)
    const existing = await db
      .select({ id: projectRoleAssignments.id })
      .from(projectRoleAssignments)
      .where(
        and(
          eq(projectRoleAssignments.projectId, input.projectId),
          eq(projectRoleAssignments.userId, input.userId),
          eq(projectRoleAssignments.roleId, input.roleId),
          eq(projectRoleAssignments.assignmentScope, input.assignmentScope),
        ),
      )
      .limit(1)
      .get()

    if (existing) {
      await db
        .update(projectRoleAssignments)
        .set({
          notes,
          isActive: true,
          updatedAt: now,
        })
        .where(eq(projectRoleAssignments.id, existing.id))
        .run()
      revalidatePath(`/dashboard/projects/${input.projectId}`)
      return { success: true, id: existing.id }
    }

    const id = crypto.randomUUID()
    await db
      .insert(projectRoleAssignments)
      .values({
        id,
        projectId: input.projectId,
        userId: input.userId,
        roleId: input.roleId,
        assignmentScope: input.assignmentScope,
        notes,
        isActive: true,
        assignedBy: user.id,
        assignedAt: now,
        updatedAt: now,
      })
      .run()

    revalidatePath(`/dashboard/projects/${input.projectId}`)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to assign role.",
    }
  }
}

export async function removeProjectRoleAssignment(input: {
  readonly projectId: string
  readonly assignmentId: string
}): Promise<ProjectRoleAssignmentActionResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "update")
    if (!canManageProjectRegistry(user)) {
      return { success: false, error: "Project role assignments are admin-only." }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await assertProjectAccess(db, user, input.projectId)

    const now = new Date().toISOString()
    await db
      .update(projectRoleAssignments)
      .set({
        isActive: false,
        updatedAt: now,
      })
      .where(
        and(
          eq(projectRoleAssignments.id, input.assignmentId),
          eq(projectRoleAssignments.projectId, input.projectId),
        ),
      )
      .run()

    revalidatePath(`/dashboard/projects/${input.projectId}`)
    return { success: true, id: input.assignmentId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to remove role.",
    }
  }
}
