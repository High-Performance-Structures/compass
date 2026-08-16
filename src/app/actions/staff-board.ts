"use server"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { organizationMembers, staffBoardPosts, users } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { createNotificationEvent } from "@/lib/notifications/events"
import { requirePermission } from "@/lib/permissions"
import {
  hasActiveStaffBoardOrganization,
  validateStaffBoardPost,
} from "@/lib/staff-board"
import { isInternalStaffRole, USER_ROLES } from "@/lib/user-roles"

export type StaffBoardPost = {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly isPinned: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly author: {
    readonly id: string
    readonly displayName: string | null
    readonly email: string
  }
}

type StaffBoardResult =
  | { readonly success: true; readonly data: readonly StaffBoardPost[] }
  | { readonly success: false; readonly error: string }

type StaffBoardActionResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

async function requireStaffBoardUser() {
  const user = await getCurrentUser()
  if (!user || !(await hasActiveStaffBoardOrganization(user))) {
    return null
  }
  return user
}

export async function listStaffBoardPosts(): Promise<StaffBoardResult> {
  try {
    const user = await requireStaffBoardUser()
    if (!user) return { success: false, error: "Staff access required" }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const rows = await db
      .select({
        id: staffBoardPosts.id,
        title: staffBoardPosts.title,
        body: staffBoardPosts.body,
        isPinned: staffBoardPosts.isPinned,
        createdAt: staffBoardPosts.createdAt,
        updatedAt: staffBoardPosts.updatedAt,
        authorId: users.id,
        authorDisplayName: users.displayName,
        authorEmail: users.email,
      })
      .from(staffBoardPosts)
      .innerJoin(users, eq(users.id, staffBoardPosts.authorId))
      .where(
        and(
          eq(staffBoardPosts.organizationId, organizationId),
          isNull(staffBoardPosts.archivedAt)
        )
      )
      .orderBy(desc(staffBoardPosts.isPinned), desc(staffBoardPosts.createdAt))
      .limit(100)

    return {
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        isPinned: row.isPinned,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        author: {
          id: row.authorId,
          displayName: row.authorDisplayName,
          email: row.authorEmail,
        },
      })),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load staff board",
    }
  }
}

export async function createStaffBoardPost(input: unknown): Promise<StaffBoardActionResult> {
  try {
    const user = await requireStaffBoardUser()
    if (!user) return { success: false, error: "Staff access required" }
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    const validation = validateStaffBoardPost(input)
    if (!validation.success) return validation

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()
    const postId = crypto.randomUUID()
    await db.insert(staffBoardPosts).values({
      id: postId,
      organizationId,
      authorId: user.id,
      title: validation.data.title,
      body: validation.data.body,
      isPinned: false,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })

    try {
      const recipients = await db
        .select({ userId: users.id, email: users.email, role: organizationMembers.role })
        .from(users)
        .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(users.isActive, true)
          )
        )
        .then((rows) =>
          rows
            .filter(
              (row) => row.userId !== user.id && isInternalStaffRole(row.role)
            )
            .map((row) => ({ userId: row.userId, email: row.email }))
        )

      if (recipients.length > 0) {
        await createNotificationEvent({
          organizationId,
          projectId: null,
          eventType: "staff_board.post_created",
          sourceType: "staff_board_post",
          sourceId: postId,
          title: validation.data.title,
          body: `${user.displayName ?? user.email} posted to the Staff Board.`,
          href: "/dashboard/staff-board",
          priority: "normal",
          audience: "internal",
          createdBy: user.id,
          recipients,
          recipientRoles: USER_ROLES.filter(isInternalStaffRole),
          delivery: { inApp: true, email: false, push: false },
        })
      }
    } catch {
      // The post is the primary action; a notification outage must not make a
      // successful post look failed and invite the user to submit it twice.
    }

    revalidatePath("/dashboard/staff-board")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create staff board post",
    }
  }
}

export async function deleteStaffBoardPost(
  postId: string
): Promise<StaffBoardActionResult> {
  try {
    const user = await requireStaffBoardUser()
    if (!user) return { success: false, error: "Staff access required" }
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const post = await db
      .select({ id: staffBoardPosts.id, authorId: staffBoardPosts.authorId })
      .from(staffBoardPosts)
      .where(
        and(
          eq(staffBoardPosts.id, postId),
          eq(staffBoardPosts.organizationId, organizationId),
          isNull(staffBoardPosts.archivedAt)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!post) return { success: false, error: "Post not found" }

    if (post.authorId !== user.id) {
      try {
        requirePermission(user, "channels", "moderate")
      } catch {
        return { success: false, error: "Only the author or a moderator can remove posts" }
      }
    }

    await db
      .update(staffBoardPosts)
      .set({ archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(staffBoardPosts.id, postId),
          eq(staffBoardPosts.organizationId, organizationId),
          isNull(staffBoardPosts.archivedAt)
        )
      )
    revalidatePath("/dashboard/staff-board")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to remove staff board post",
    }
  }
}

export async function toggleStaffBoardPostPin(
  postId: string
): Promise<StaffBoardActionResult> {
  try {
    const user = await requireStaffBoardUser()
    if (!user) return { success: false, error: "Staff access required" }
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "channels", "moderate")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const post = await db
      .select({ id: staffBoardPosts.id })
      .from(staffBoardPosts)
      .where(
        and(
          eq(staffBoardPosts.id, postId),
          eq(staffBoardPosts.organizationId, organizationId),
          isNull(staffBoardPosts.archivedAt)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!post) return { success: false, error: "Post not found" }
    await db
      .update(staffBoardPosts)
      .set({
        isPinned: sql`NOT ${staffBoardPosts.isPinned}`,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(staffBoardPosts.id, postId),
          eq(staffBoardPosts.organizationId, organizationId),
          isNull(staffBoardPosts.archivedAt)
        )
      )
    revalidatePath("/dashboard/staff-board")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update staff board post",
    }
  }
}
