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
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import {
  EXTERNAL_PROJECT_RECIPIENT_ROLES,
  isExternalProjectResourceType,
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

async function grantDb(projectId: string): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly actor: Awaited<ReturnType<typeof requireAuth>>
}> {
  const actor = await requireAuth()
  await requireFeaturePermission(actor, "project-photos", "update")
  const organizationId = requireOrg(actor)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
  if (!project) throw new Error("Project not found")
  return { db, organizationId, actor }
}

export async function getExternalProjectResourceRecipients(
  projectId: string
): Promise<readonly ExternalProjectResourceRecipient[]> {
  const { db } = await grantDb(projectId)
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
        inArray(projectMembers.role, EXTERNAL_PROJECT_RECIPIENT_ROLES),
        eq(users.isActive, true)
      )
    )
  return rows.map((row) => ({
    ...row,
    displayName: row.displayName?.trim() || row.email,
  }))
}

export async function getExternalProjectResourceGrantRecipientIds(input: {
  readonly projectId: string
  readonly resourceType: ExternalProjectResourceType
  readonly resourceId: string
}): Promise<readonly string[]> {
  if (!isExternalProjectResourceType(input.resourceType) || input.resourceId.trim().length === 0) {
    return []
  }
  const { db, organizationId } = await grantDb(input.projectId)
  const rows = await db
    .select({ recipientUserId: projectExternalResourceGrants.recipientUserId })
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
  return rows.map((row) => row.recipientUserId)
}

export async function setExternalProjectResourceRecipients(input: {
  readonly projectId: string
  readonly resourceType: ExternalProjectResourceType
  readonly resourceId: string
  readonly recipientUserIds: readonly string[]
}): Promise<GrantResult> {
  try {
    if (!isExternalProjectResourceType(input.resourceType)) {
      return { success: false, error: "Unsupported project resource." }
    }
    if (input.resourceId.trim().length === 0) {
      return { success: false, error: "Project resource is required." }
    }

    const { db, organizationId, actor } = await grantDb(input.projectId)
    if (isDemoUser(actor.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const requestedIds = [...new Set(input.recipientUserIds)]
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    const eligible = await getExternalProjectResourceRecipients(input.projectId)
    const eligibleIds = new Set(eligible.map((recipient) => recipient.userId))
    if (requestedIds.some((id) => !eligibleIds.has(id))) {
      return { success: false, error: "Choose assigned external project members only." }
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
    const now = new Date().toISOString()
    const requested = new Set(requestedIds)
    const revokeIds = active
      .filter((grant) => !requested.has(grant.recipientUserId))
      .map((grant) => grant.id)
    if (revokeIds.length > 0) {
      await db
        .update(projectExternalResourceGrants)
        .set({ revokedAt: now, revokedBy: actor.id })
        .where(inArray(projectExternalResourceGrants.id, revokeIds))
    }

    const activeRecipients = new Set(active.map((grant) => grant.recipientUserId))
    const createIds = requestedIds.filter((id) => !activeRecipients.has(id))
    if (createIds.length > 0) {
      await db.insert(projectExternalResourceGrants).values(
        createIds.map((recipientUserId) => ({
          id: crypto.randomUUID(),
          organizationId,
          projectId: input.projectId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          recipientUserId,
          grantedBy: actor.id,
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
      error: error instanceof Error ? error.message : "Unable to update sharing.",
    }
  }
}
