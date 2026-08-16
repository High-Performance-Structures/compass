"use server"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  notificationEvents,
  notificationRecipients,
  staffBoardPosts,
  users,
} from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import {
  getActiveStaffBoardOrganization,
  getStaffBoardRecipients,
  validateStaffBoardPost,
} from "@/lib/staff-board"
import { requirePermission } from "@/lib/permissions"

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

type StaffBoardContext = {
  readonly user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
  readonly organizationId: string
}

async function requireStaffBoardContext(): Promise<StaffBoardContext | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const organizationId = await getActiveStaffBoardOrganization(user)
  if (!organizationId) return null
  return { user, organizationId }
}

async function staffBoardDb(): Promise<ReturnType<typeof getDb>> {
  const { env } = await getCloudflareContext()
  return getDb(env.DB)
}

export async function listStaffBoardPosts(): Promise<StaffBoardResult> {
  try {
    const context = await requireStaffBoardContext()
    if (!context) return { success: false, error: "Staff access required" }
    const db = await staffBoardDb()
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
          eq(staffBoardPosts.organizationId, context.organizationId),
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

export async function createStaffBoardPost(
  input: unknown
): Promise<StaffBoardActionResult> {
  try {
    const context = await requireStaffBoardContext()
    if (!context) return { success: false, error: "Staff access required" }
    if (isDemoUser(context.user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const validation = validateStaffBoardPost(input)
    if (!validation.success) return validation

    const db = await staffBoardDb()
    const now = new Date().toISOString()
    const postId = crypto.randomUUID()
    const eventId = crypto.randomUUID()
    const recipients = await getStaffBoardRecipients(
      db,
      context.organizationId,
      context.user.id
    )

    const postStatement = db.insert(staffBoardPosts).values({
        id: postId,
        organizationId: context.organizationId,
        authorId: context.user.id,
        title: validation.data.title,
        body: validation.data.body,
        isPinned: false,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })

    if (recipients.length === 0) {
      await db.batch([postStatement])
    } else {
      await db.batch([
        postStatement,
        db.insert(notificationEvents).values({
          id: eventId,
          organizationId: context.organizationId,
          projectId: null,
          eventType: "staff_board.post_created",
          sourceType: "staff_board",
          sourceId: postId,
          title: validation.data.title,
          body: `${context.user.displayName ?? context.user.email} posted to the Staff Board.`,
          href: "/dashboard/staff-board",
          priority: "normal",
          audience: "internal",
          createdBy: context.user.id,
          createdAt: now,
        }),
        ...recipients.map((recipient) =>
          db.insert(notificationRecipients).values({
            id: crypto.randomUUID(),
            eventId,
            userId: recipient.userId,
            inApp: true,
            email: false,
            sms: false,
            push: false,
            readAt: null,
            dismissedAt: null,
            createdAt: now,
          })
        )
      ])
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
    const context = await requireStaffBoardContext()
    if (!context) return { success: false, error: "Staff access required" }
    if (isDemoUser(context.user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const db = await staffBoardDb()
    const post = await db
      .select({ id: staffBoardPosts.id, authorId: staffBoardPosts.authorId })
      .from(staffBoardPosts)
      .where(
        and(
          eq(staffBoardPosts.id, postId),
          eq(staffBoardPosts.organizationId, context.organizationId),
          isNull(staffBoardPosts.archivedAt)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!post) return { success: false, error: "Post not found" }

    const isAuthor = post.authorId === context.user.id
    if (!isAuthor) {
      try {
        requirePermission(context.user, "channels", "moderate")
      } catch {
        return {
          success: false,
          error: "Only the author or a moderator can remove posts",
        }
      }
    }

    const where = and(
      eq(staffBoardPosts.id, postId),
      eq(staffBoardPosts.organizationId, context.organizationId),
      ...(isAuthor ? [eq(staffBoardPosts.authorId, context.user.id)] : []),
      isNull(staffBoardPosts.archivedAt)
    )
    const removed = await db
      .update(staffBoardPosts)
      .set({ archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(where)
      .returning({ id: staffBoardPosts.id })
    if (removed.length === 0) return { success: false, error: "Post not found" }
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
    const context = await requireStaffBoardContext()
    if (!context) return { success: false, error: "Staff access required" }
    if (isDemoUser(context.user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(context.user, "channels", "moderate")
    const db = await staffBoardDb()
    const updated = await db
      .update(staffBoardPosts)
      .set({
        isPinned: sql`NOT ${staffBoardPosts.isPinned}`,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(staffBoardPosts.id, postId),
          eq(staffBoardPosts.organizationId, context.organizationId),
          isNull(staffBoardPosts.archivedAt)
        )
      )
      .returning({ id: staffBoardPosts.id })
    if (updated.length === 0) return { success: false, error: "Post not found" }
    revalidatePath("/dashboard/staff-board")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update staff board post",
    }
  }
}
