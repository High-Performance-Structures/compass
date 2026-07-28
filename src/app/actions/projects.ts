"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { projectExternalLinks, projectMembers, projects } from "@/db/schema"
import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { canUseOrganizationProjectScopeRole } from "@/lib/user-roles"

export type ProjectStatusValue =
  | "OPEN"
  | "WARRANTY"
  | "COMPLETE"
  | "INACTIVE"
  | "ARCHIVE"
  | "OTHER"

const PROJECT_STATUS_VALUES: readonly ProjectStatusValue[] = [
  "OPEN",
  "WARRANTY",
  "COMPLETE",
  "INACTIVE",
  "ARCHIVE",
  "OTHER",
]

export type ProjectListItem = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly clientName: string | null
  readonly googleDriveFolderId: string | null
  readonly status: string
  readonly createdAt: string
}

export type CreateProjectShellInput = {
  readonly projectNumber: string | null
  readonly name: string
  readonly department: "O" | "H" | "N" | "D" | "UNASSIGNED"
  readonly clientName: string | null
  readonly address: string | null
  readonly status: string
}

type CreateProjectShellResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type UpdateProjectStatusResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${label} is required`)
  return trimmed
}

function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

function departmentPrefix(
  department: CreateProjectShellInput["department"]
): string {
  if (department === "O") return "o"
  if (department === "H") return "h"
  if (department === "N") return "n"
  if (department === "D") return "d"
  return "unassigned"
}

function isProjectStatusValue(value: string): value is ProjectStatusValue {
  return PROJECT_STATUS_VALUES.some((status) => status === value)
}

export async function getProjects(): Promise<ProjectListItem[]> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "read")

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)

    if (
      user.organizationId &&
      user.organizationType === "internal" &&
      canUseOrganizationProjectScopeRole(user.role)
    ) {
      return await db
        .select({
          id: projects.id,
          name: projects.name,
          projectNumber: projects.projectNumber,
          clientName: projects.clientName,
          googleDriveFolderId: projects.googleDriveFolderId,
          status: projects.status,
          createdAt: projects.createdAt,
        })
        .from(projects)
        .where(eq(projects.organizationId, user.organizationId))
        .orderBy(asc(projects.projectNumber), asc(projects.name))
    }

    return await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        clientName: projects.clientName,
        googleDriveFolderId: projects.googleDriveFolderId,
        status: projects.status,
        createdAt: projects.createdAt,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(eq(projectMembers.userId, user.id))
      .orderBy(asc(projects.projectNumber), asc(projects.name))
  } catch {
    return []
  }
}

export async function createProjectShell(
  input: CreateProjectShellInput
): Promise<CreateProjectShellResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "create")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "D1 not available" }

    const db = getDb(env.DB)
    const projectNumber = cleanText(input.projectNumber)
    const name = requireText(input.name, "Project name")
    const status = cleanText(input.status) ?? "OPEN"

    if (projectNumber) {
      const duplicate = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, orgId),
            eq(projects.projectNumber, projectNumber)
          )
        )
        .limit(1)

      if (duplicate[0]) {
        return {
          success: false,
          error: "A project with that Compass number already exists.",
        }
      }
    }

    const now = new Date().toISOString()
    const idBase = projectNumber
      ? slugPart(projectNumber)
      : `${departmentPrefix(input.department)}-${slugPart(name)}`
    const id = `proj-${idBase}-${crypto.randomUUID().slice(0, 8)}`

    await db.insert(projects).values({
      id,
      organizationId: orgId,
      projectNumber,
      name,
      status,
      address: cleanText(input.address),
      clientName: cleanText(input.clientName),
      ownerUpdatesEnabled: true,
      ownerUpdateChannel: "compass",
      ownerUpdateCadence: "weekly",
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(projectExternalLinks).values({
      id: crypto.randomUUID(),
      projectId: id,
      system: "compass",
      label: "Compass project shell",
      externalId: id,
      externalNumber: projectNumber,
      externalUrl: `/dashboard/projects/${id}`,
      syncDirection: "bidirectional",
      syncStatus: "mapped",
      metadata: JSON.stringify({ department: input.department }),
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath("/dashboard/projects")
    revalidatePath(`/dashboard/projects/${id}`)
    revalidatePath("/dashboard")
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create project",
    }
  }
}

export async function updateProjectStatus(
  projectId: string,
  status: string
): Promise<UpdateProjectStatusResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "update")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "D1 not available" }

    if (!isProjectStatusValue(status)) {
      return { success: false, error: "Unsupported project status." }
    }

    const db = getDb(env.DB)
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.organizationId, orgId))
      )
      .limit(1)

    if (!existing[0]) {
      return { success: false, error: "Project not found" }
    }

    await db
      .update(projects)
      .set({
        status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, projectId))

    revalidatePath("/dashboard/projects")
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath("/dashboard")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update project status",
    }
  }
}
