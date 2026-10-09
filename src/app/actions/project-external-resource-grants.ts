"use server"

import { and, eq, inArray, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectExternalResourceGrants,
  projectMembers,
  projects,
  users,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { getActiveOrganization } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  EXTERNAL_PROJECT_RESOURCE_TYPES,
  type ExternalProjectResourceType,
} from "@/lib/project-external-resource-access"

export type ExternalProjectResourceRecipient = {
  readonly userId: string
  readonly displayName: string
  readonly email: string
  readonly role: string
}

type GrantResult =
  | { readonly success: true; readonly recipientUserIds: readonly string[] }
  | { readonly success: false; readonly error: string }

type GrantContext = {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly actorId: string
}

function isResourceType(value: string): value is ExternalProjectResourceType {
  return EXTERNAL_PROJECT_RESOURCE_TYPES.some((type) => type === value)
}

async function requireGrantContext(projectId: string): Promise<GrantContext> {
  const actor = await requireAuth()
  if (!actor.isActive || !actor.organizationId || !isInternalStaffRole(actor.role)) {
    throw new Error("External resource grants require active internal staff")
  }
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const organization = await getActiveOrganization(db, actor)
  if (
    !organization ||
    organization.id !== actor.organizationId ||
    organization.type !== "internal"
  ) {
    throw new Error("External resource grants require active internal staff")
  }
  requirePermission(actor, "project", "update")
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organization.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!project) throw new Error("Project not found")
  return { db, organizationId: organization.id, actorId: actor.id }
}

export async function getExternalProjectResourceRecipients(
  projectId: string
): Promise<readonly ExternalProjectResourceRecipient[]> {
  const { db } = await requireGrantContext(projectId)
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        inArray(projectMembers.role, ["client", "owner", "subcontractor", "supplier"]),
        eq(users.isActive, true)
      )
    )
  return rows.map((row) => ({
    userId: row.userId,
    displayName: row.displayName?.trim() || row.email,
    email: row.email,
    role: row.role,
  }))
}

export async function setExternalProjectResourceRecipients(input: {
  readonly projectId: string
  readonly resourceType: string
  readonly resourceId: string
  readonly recipientUserIds: readonly string[]
}): Promise<GrantResult> {
  try {
    if (!isResourceType(input.resourceType) || input.resourceId.trim().length === 0) {
      return { success: false, error: "Unsupported project resource." }
    }
    const { db, organizationId, actorId } = await requireGrantContext(input.projectId)
    const requestedIds = [...new Set(input.recipientUserIds)]
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    const eligible = await db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(
        and(
          eq(projectMembers.projectId, input.projectId),
          inArray(projectMembers.userId, requestedIds),
          inArray(projectMembers.role, ["client", "owner", "subcontractor", "supplier"]),
          eq(users.isActive, true)
        )
      )
    if (eligible.length !== requestedIds.length) {
      return { success: false, error: "Choose active assigned external project members only." }
    }

    const active = await db
      .select({
        id: projectExternalResourceGrants.id,
        recipientUserId: projectExternalResourceGrants.recipientUserId,
      })
      .from(projectExternalResourceGrants)
      .where(
        and(
          eq(projectExternalResourceGrants.organizationId, organizationId),
          eq(projectExternalResourceGrants.projectId, input.projectId),
          eq(projectExternalResourceGrants.resourceType, input.resourceType),
          eq(projectExternalResourceGrants.resourceId, input.resourceId),
          isNull(projectExternalResourceGrants.revokedAt)
        )
      )
    const requested = new Set(requestedIds)
    const revokeIds = active
      .filter((grant) => !requested.has(grant.recipientUserId))
      .map((grant) => grant.id)
    const now = new Date().toISOString()
    if (revokeIds.length > 0) {
      await db
        .update(projectExternalResourceGrants)
        .set({ revokedAt: now, revokedBy: actorId })
        .where(inArray(projectExternalResourceGrants.id, revokeIds))
    }
    const activeRecipientIds = new Set(active.map((grant) => grant.recipientUserId))
    const createIds = requestedIds.filter((id) => !activeRecipientIds.has(id))
    if (createIds.length > 0) {
      await db.insert(projectExternalResourceGrants).values(
        createIds.map((recipientUserId) => ({
          id: crypto.randomUUID(),
          organizationId,
          projectId: input.projectId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          recipientUserId,
          grantedBy: actorId,
          grantedAt: now,
          revokedBy: null,
          revokedAt: null,
        }))
      )
    }
    revalidatePath(`/dashboard/projects/${input.projectId}/photos`)
    revalidatePath(`/dashboard/projects/${input.projectId}/videos`)
    revalidatePath(`/preview/projects/${input.projectId}/owner`)
    revalidatePath(`/preview/projects/${input.projectId}/sub-vendor`)
    return { success: true, recipientUserIds: requestedIds }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to update resource sharing.",
    }
  }
}
