"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  organizationInvites,
  organizationMembers,
  organizations,
  users,
  type NewOrganizationInvite,
} from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { canManageUserAccess, requirePermission } from "@/lib/permissions"
import { isDemoUser } from "@/lib/demo"
import { userRoleSchema } from "@/lib/validations/common"
import { eq, and, desc } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"

// unambiguous charset — no 0/O/1/I/l
const CODE_CHARS = "23456789abcdefghjkmnpqrstuvwxyz"

function generateInviteCode(orgSlug: string): string {
  const prefix = orgSlug.replace(/[^a-z0-9]/g, "").slice(0, 3)
  const suffix = Array.from(
    { length: 6 },
    () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join("")
  return `${prefix}-${suffix}`
}

// --- createInvite ---

export async function createInvite(
  role: string,
  maxUses?: number,
  expiresAt?: string
): Promise<{ success: boolean; error?: string; data?: { code: string; url: string } }> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Unauthorized" }
    if (isDemoUser(currentUser.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(currentUser, "organization", "create")
    if (!canManageUserAccess(currentUser)) {
      return { success: false, error: "Only admins can create invite links" }
    }

    const roleParseResult = userRoleSchema.safeParse(role)
    if (!roleParseResult.success) {
      return { success: false, error: "Please select a valid role" }
    }

    if (!currentUser.organizationId) {
      return { success: false, error: "No active organization" }
    }

    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "Database not available" }

    const db = getDb(env.DB)

    const org = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, currentUser.organizationId))
      .get()

    if (!org) return { success: false, error: "Organization not found" }

    const code = generateInviteCode(org.slug)
    const now = new Date().toISOString()

    const invite: NewOrganizationInvite = {
      id: crypto.randomUUID(),
      organizationId: currentUser.organizationId,
      code,
      role: roleParseResult.data,
      maxUses: maxUses ?? null,
      useCount: 0,
      expiresAt: expiresAt ?? null,
      createdBy: currentUser.id,
      isActive: true,
      createdAt: now,
    }

    await db.insert(organizationInvites).values(invite).run()

    revalidatePath("/dashboard/settings")
    return {
      success: true,
      data: {
        code,
        url: `/join/${code}`,
      },
    }
  } catch (error) {
    console.error("Error creating invite:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

// --- getOrgInvites ---

export async function getOrgInvites(): Promise<{
  success: boolean
  error?: string
  data?: ReadonlyArray<{
    readonly id: string
    readonly code: string
    readonly role: string
    readonly maxUses: number | null
    readonly useCount: number
    readonly expiresAt: string | null
    readonly isActive: boolean
    readonly createdAt: string
    readonly createdByName: string | null
  }>
}> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Unauthorized" }
    requirePermission(currentUser, "organization", "read")
    if (!canManageUserAccess(currentUser)) {
      return { success: false, error: "Only admins can view invite links" }
    }

    if (!currentUser.organizationId) {
      return { success: false, error: "No active organization" }
    }

    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "Database not available" }

    const db = getDb(env.DB)

    const invites = await db
      .select({
        id: organizationInvites.id,
        code: organizationInvites.code,
        role: organizationInvites.role,
        maxUses: organizationInvites.maxUses,
        useCount: organizationInvites.useCount,
        expiresAt: organizationInvites.expiresAt,
        isActive: organizationInvites.isActive,
        createdAt: organizationInvites.createdAt,
        createdByName: users.displayName,
      })
      .from(organizationInvites)
      .leftJoin(users, eq(organizationInvites.createdBy, users.id))
      .where(eq(organizationInvites.organizationId, currentUser.organizationId))
      .orderBy(desc(organizationInvites.createdAt))

    return { success: true, data: invites }
  } catch (error) {
    console.error("Error fetching org invites:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

// --- revokeInvite ---

export async function revokeInvite(
  inviteId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Unauthorized" }
    if (isDemoUser(currentUser.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(currentUser, "organization", "update")
    if (!canManageUserAccess(currentUser)) {
      return { success: false, error: "Only admins can revoke invite links" }
    }

    if (!currentUser.organizationId) {
      return { success: false, error: "No active organization" }
    }

    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "Database not available" }

    const db = getDb(env.DB)

    // verify invite belongs to this org before revoking
    const invite = await db
      .select({ id: organizationInvites.id })
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.id, inviteId),
          eq(organizationInvites.organizationId, currentUser.organizationId)
        )
      )
      .get()

    if (!invite) return { success: false, error: "Invite not found" }

    await db
      .update(organizationInvites)
      .set({ isActive: false })
      .where(eq(organizationInvites.id, inviteId))
      .run()

    revalidatePath("/dashboard/settings")
    return { success: true }
  } catch (error) {
    console.error("Error revoking invite:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

// --- getInviteByCode (public — no auth) ---

export async function getInviteByCode(code: string): Promise<{
  success: boolean
  error?: string
  data?: {
    readonly organizationName: string
    readonly role: string
  }
}> {
  const INVALID = "This invite link is invalid or has expired"
  try {
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: INVALID }

    const db = getDb(env.DB)

    const row = await db
      .select({
        id: organizationInvites.id,
        role: organizationInvites.role,
        maxUses: organizationInvites.maxUses,
        useCount: organizationInvites.useCount,
        expiresAt: organizationInvites.expiresAt,
        isActive: organizationInvites.isActive,
        organizationName: organizations.name,
      })
      .from(organizationInvites)
      .innerJoin(organizations, eq(organizationInvites.organizationId, organizations.id))
      .where(eq(organizationInvites.code, code))
      .get()

    if (!row || !row.isActive) return { success: false, error: INVALID }
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      return { success: false, error: INVALID }
    }
    if (row.maxUses !== null && row.useCount >= row.maxUses) {
      return { success: false, error: INVALID }
    }

    return { success: true, data: { organizationName: row.organizationName, role: row.role } }
  } catch (error) {
    console.error("Error looking up invite:", error)
    return { success: false, error: INVALID }
  }
}

// --- acceptInvite ---

export async function acceptInvite(code: string): Promise<{
  success: boolean
  error?: string
  data?: { organizationId: string; organizationName: string }
}> {
  const INVALID = "This invite link is invalid or has expired"
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Unauthorized" }
    if (isDemoUser(currentUser.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "Database not available" }

    const db = getDb(env.DB)

    const invite = await db
      .select({
        id: organizationInvites.id,
        organizationId: organizationInvites.organizationId,
        role: organizationInvites.role,
        maxUses: organizationInvites.maxUses,
        useCount: organizationInvites.useCount,
        expiresAt: organizationInvites.expiresAt,
        isActive: organizationInvites.isActive,
        organizationName: organizations.name,
      })
      .from(organizationInvites)
      .innerJoin(organizations, eq(organizationInvites.organizationId, organizations.id))
      .where(eq(organizationInvites.code, code))
      .get()

    if (!invite || !invite.isActive) return { success: false, error: INVALID }
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return { success: false, error: INVALID }
    }
    if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
      return { success: false, error: INVALID }
    }

    // check user is not already a member
    const existing = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, invite.organizationId),
          eq(organizationMembers.userId, currentUser.id)
        )
      )
      .get()

    if (existing) {
      return { success: false, error: "You are already a member of this organization" }
    }

    const now = new Date().toISOString()

    await db
      .insert(organizationMembers)
      .values({
        id: crypto.randomUUID(),
        organizationId: invite.organizationId,
        userId: currentUser.id,
        role: invite.role,
        joinedAt: now,
      })
      .run()

    const newUseCount = invite.useCount + 1
    const exhausted = invite.maxUses !== null && newUseCount >= invite.maxUses

    await db
      .update(organizationInvites)
      .set({
        useCount: newUseCount,
        ...(exhausted ? { isActive: false } : {}),
      })
      .where(eq(organizationInvites.id, invite.id))
      .run()

    const cookieStore = await cookies()
    cookieStore.set("compass-active-org", invite.organizationId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    })

    revalidatePath("/dashboard")
    return {
      success: true,
      data: {
        organizationId: invite.organizationId,
        organizationName: invite.organizationName,
      },
    }
  } catch (error) {
    console.error("Error accepting invite:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
