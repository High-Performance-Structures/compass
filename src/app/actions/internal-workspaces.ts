"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { projectProfileAuditEvents, projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { isWorkspaceKind, type WorkspaceKind } from "@/lib/internal-duties/model"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { canCreateProject } from "@/lib/permissions"
import { isProjectDepartment, type ProjectDepartment } from "@/lib/project-branding"
import { getProjectAccessRecord } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type ProjectWorkspaceInput = {
  readonly projectId: string
  /** Null makes it a regular client job again. */
  readonly workspaceKind: WorkspaceKind | null
  /** Listed under the Internal department; only internal workspaces can be. */
  readonly internalDepartment: boolean
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** Sets whether a project is an internal workspace (and which kind) and whether it's listed under Internal. */
export async function updateProjectWorkspace(input: ProjectWorkspaceInput): Promise<Result<null>> {
  try {
    const user = await requireAuth()
    await requireFeaturePermission(user, "project-hub", "update")
    if (!isInternalStaffRole(user.role)) return { success: false, error: "Only staff can change this." }
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    if (input.workspaceKind !== null && !isWorkspaceKind(input.workspaceKind)) {
      return { success: false, error: "Choose a workspace type." }
    }
    if (input.internalDepartment && input.workspaceKind === null) {
      return { success: false, error: "Only an internal workspace can be listed under the Internal department." }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "Database unavailable" }
    const db = getDb(env.DB)
    const access = await getProjectAccessRecord(db, user, input.projectId)
    if (!access || access.organizationId !== organizationId) return { success: false, error: "Project not found." }

    const [before] = await db
      .select({ workspaceKind: projects.workspaceKind, internalDepartment: projects.internalDepartment })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, organizationId)))
      .limit(1)
    if (!before) return { success: false, error: "Project not found." }
    const now = new Date().toISOString()
    const after = { workspaceKind: input.workspaceKind, internalDepartment: input.internalDepartment }
    await db.batch([
      db
        .update(projects)
        .set({ ...after, updatedAt: now })
        .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, organizationId))),
      db.insert(projectProfileAuditEvents).values({
        id: crypto.randomUUID(),
        organizationId,
        projectId: input.projectId,
        actorUserId: user.id,
        eventType: "workspace_updated",
        entityType: "project",
        entityId: input.projectId,
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(after),
        createdAt: now,
      }),
    ])
    revalidatePath(`/dashboard/projects/${input.projectId}`)
    revalidatePath("/dashboard/projects")
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "The workspace settings could not be saved.") }
  }
}

export type CreateInternalWorkspaceInput = {
  readonly name: string
  readonly workspaceKind: WorkspaceKind
  /** The department it belongs to for numbering and cost codes. */
  readonly department: ProjectDepartment
  readonly projectNumber: string | null
}

/**
 * A new internal workspace under the Internal department: no client,
 * estimate, Sage job or Drive folder, and the "Internal" job status so it
 * never ages in client follow-up.
 */
export async function createInternalWorkspace(input: CreateInternalWorkspaceInput): Promise<Result<{ readonly projectId: string }>> {
  try {
    const user = await requireAuth()
    if (!canCreateProject(user) || !isInternalStaffRole(user.role)) {
      return { success: false, error: "You don't have permission to create projects." }
    }
    const organizationId = requireOrg(user)
    if (isDemoOrg(organizationId)) return { success: false, error: "Demo data cannot be changed." }
    const name = input.name.trim()
    if (name.length < 2 || name.length > 120) return { success: false, error: "Enter a name between 2 and 120 characters." }
    if (!isWorkspaceKind(input.workspaceKind)) return { success: false, error: "Choose a workspace type." }
    if (!isProjectDepartment(input.department)) return { success: false, error: "Choose the department it belongs to." }
    const projectNumber = input.projectNumber?.trim().toUpperCase() || null
    if (projectNumber !== null && !/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(projectNumber)) {
      return { success: false, error: "Use letters, numbers and dashes for the number, or leave it blank." }
    }
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "Database unavailable" }
    const db = getDb(env.DB)
    if (projectNumber !== null) {
      const [taken] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.organizationId, organizationId), eq(projects.projectNumber, projectNumber)))
        .limit(1)
      if (taken) return { success: false, error: `${projectNumber} is already used by another project.` }
    }
    const projectId = `proj-internal-${crypto.randomUUID().slice(0, 12)}`
    const now = new Date().toISOString()
    await db.insert(projects).values({
      id: projectId,
      organizationId,
      projectNumber,
      department: input.department,
      name,
      status: "OPEN",
      clientStatus: "customer",
      jobStatusId: "internal",
      workspaceKind: input.workspaceKind,
      internalDepartment: true,
      ownerUpdatesEnabled: false,
      portfolioMapVisibility: "default",
      createdAt: now,
      updatedAt: now,
    })
    revalidatePath("/dashboard/projects")
    return { success: true, data: { projectId } }
  } catch (error) {
    return { success: false, error: message(error, "The workspace could not be created.") }
  }
}
