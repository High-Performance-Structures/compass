"use server"

import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  cherishPulseResponses,
  cherishPulseStoryReplies,
  cherishPulseStoryStates,
  notificationEvents,
  notificationRecipients,
} from "@/db/schema"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { isInternalStaffRole } from "@/lib/user-roles"
import { createNotificationEvent } from "@/lib/notifications/events"

export type CherishStory = {
  readonly id: string
  readonly cherishValue: string
  readonly responseType: "shoutout" | "win"
  readonly message: string
  readonly isAnonymous: boolean
  readonly submittedByName: string | null
  readonly publishedAt: string
  readonly viewedAt: string | null
  readonly reactedAt: string | null
  readonly reactionCount: number
  readonly audience: {
    readonly scope: "company"
  }
}

type StoryActionResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

type StoryStateInput = {
  readonly id: string
}

type StoryReactionInput = StoryStateInput & {
  readonly reacted: boolean
}

type StoryReplyInput = StoryStateInput & {
  readonly message: string
}

const STORY_WINDOW_MS = 24 * 60 * 60 * 1_000

export async function getActiveCherishStories(): Promise<
  StoryActionResult<readonly CherishStory[]>
> {
  return getCherishStories({ activeOnly: true, limit: 20 })
}

export async function getCherishStoryArchive(): Promise<
  StoryActionResult<readonly CherishStory[]>
> {
  return getCherishStories({ activeOnly: false, limit: 100 })
}

export async function markCherishStoryViewed(
  input: StoryStateInput,
): Promise<StoryActionResult<{ readonly viewedAt: string }>> {
  try {
    const context = await storyMutationContext(input.id)
    if (!context.success) return context

    const now = new Date().toISOString()
    await context.db
      .insert(cherishPulseStoryStates)
      .values({
        id: crypto.randomUUID(),
        organizationId: context.organizationId,
        responseId: context.responseId,
        userId: context.user.id,
        viewedAt: now,
        reactedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          cherishPulseStoryStates.responseId,
          cherishPulseStoryStates.userId,
        ],
        set: {
          viewedAt: now,
          updatedAt: now,
        },
      })
      .run()

    revalidatePath("/dashboard")
    return { success: true, data: { viewedAt: now } }
  } catch (error) {
    return storyError(error, "Unable to mark this CHERISH as viewed.")
  }
}

export async function setCherishStoryReaction(
  input: StoryReactionInput,
): Promise<StoryActionResult<{ readonly reactedAt: string | null }>> {
  try {
    if (typeof input.reacted !== "boolean") {
      return { success: false, error: "Choose a valid CHERISH reaction." }
    }

    const context = await storyMutationContext(input.id)
    if (!context.success) return context

    const now = new Date().toISOString()
    const reactedAt = input.reacted ? now : null
    await context.db
      .insert(cherishPulseStoryStates)
      .values({
        id: crypto.randomUUID(),
        organizationId: context.organizationId,
        responseId: context.responseId,
        userId: context.user.id,
        viewedAt: now,
        reactedAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          cherishPulseStoryStates.responseId,
          cherishPulseStoryStates.userId,
        ],
        set: {
          viewedAt: now,
          reactedAt,
          updatedAt: now,
        },
      })
      .run()

    revalidatePath("/dashboard")
    return { success: true, data: { reactedAt } }
  } catch (error) {
    return storyError(error, "Unable to save this CHERISH reaction.")
  }
}

export async function sendCherishStoryReply(
  input: StoryReplyInput,
): Promise<StoryActionResult<{ readonly id: string }>> {
  try {
    const message = input.message.trim()
    if (message.length === 0) {
      return { success: false, error: "Write a brief reply first." }
    }
    if (message.length > 300) {
      return { success: false, error: "Keep CHERISH replies under 300 characters." }
    }

    const context = await storyMutationContext(input.id)
    if (!context.success) return context
    if (
      context.recipientId === null ||
      context.recipientEmail === null ||
      context.recipientId === context.user.id
    ) {
      return {
        success: false,
        error: "Private replies are not available for this CHERISH.",
      }
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await context.db.insert(cherishPulseStoryReplies).values({
      id,
      organizationId: context.organizationId,
      responseId: context.responseId,
      authorId: context.user.id,
      recipientId: context.recipientId,
      message,
      deletedAt: null,
      createdAt: now,
    }).run()

    try {
      await createNotificationEvent({
        organizationId: context.organizationId,
        projectId: null,
        eventType: "cherish.story_reply",
        sourceType: "cherish_story_reply",
        sourceId: id,
        title: "A teammate replied to your CHERISH",
        body: `${replyAuthorName(context.user)}: ${message}`,
        href: `/dashboard/cherish?story=${encodeURIComponent(context.responseId)}`,
        priority: "normal",
        audience: "current_user",
        createdBy: context.user.id,
        recipients: [{
          userId: context.recipientId,
          email: context.recipientEmail,
        }],
        delivery: { inApp: true, email: false, push: false },
      })

      const delivery = await context.db
        .select({ id: notificationRecipients.id })
        .from(notificationRecipients)
        .innerJoin(
          notificationEvents,
          eq(notificationEvents.id, notificationRecipients.eventId),
        )
        .where(
          and(
            eq(notificationEvents.organizationId, context.organizationId),
            eq(notificationEvents.sourceType, "cherish_story_reply"),
            eq(notificationEvents.sourceId, id),
            eq(notificationRecipients.userId, context.recipientId),
            eq(notificationRecipients.inApp, true),
          ),
        )
        .get()
      if (!delivery) {
        throw new Error("The recipient could not receive an in-app notification.")
      }
    } catch (notificationError) {
      console.error("Unable to deliver the CHERISH reply:", notificationError)
      try {
        await rollbackUndeliveredReply(
          context.db,
          context.organizationId,
          context.user.id,
          id,
        )
      } catch (rollbackError) {
        console.error("Unable to roll back the CHERISH reply:", rollbackError)
      }
      return {
        success: false,
        error: "Unable to deliver this CHERISH reply. Please try again.",
      }
    }

    revalidatePath("/dashboard/cherish")
    return { success: true, data: { id } }
  } catch (error) {
    return storyError(error, "Unable to send this CHERISH reply.")
  }
}

async function rollbackUndeliveredReply(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  authorId: string,
  replyId: string,
): Promise<void> {
  const failedAt = new Date().toISOString()
  const redactNotification = db
    .update(notificationEvents)
    .set({
      title: "CHERISH reply not delivered",
      body: "This reply could not be delivered.",
    })
    .where(
      and(
        eq(notificationEvents.organizationId, organizationId),
        eq(notificationEvents.sourceType, "cherish_story_reply"),
        eq(notificationEvents.sourceId, replyId),
        eq(notificationEvents.createdBy, authorId),
      ),
    )
  const removeReply = db
    .update(cherishPulseStoryReplies)
    .set({ deletedAt: failedAt })
    .where(
      and(
        eq(cherishPulseStoryReplies.id, replyId),
        eq(cherishPulseStoryReplies.organizationId, organizationId),
        eq(cherishPulseStoryReplies.authorId, authorId),
        isNull(cherishPulseStoryReplies.deletedAt),
      ),
    )

  await db.batch([redactNotification, removeReply])
}

export async function deleteCherishStoryReply(
  input: StoryStateInput,
): Promise<StoryActionResult<{ readonly id: string }>> {
  try {
    const user = await requireAuth()
    if (!canViewCherishStories(user)) {
      return {
        success: false,
        error: "Only internal team members can manage CHERISH replies.",
      }
    }

    const id = input.id.trim()
    if (id.length === 0) {
      return { success: false, error: "Choose a CHERISH reply." }
    }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return {
        success: false,
        error: "Compass storage is not available right now.",
      }
    }

    const db = getDb(env.DB)
    const reply = await db
      .select({ id: cherishPulseStoryReplies.id })
      .from(cherishPulseStoryReplies)
      .where(
        and(
          eq(cherishPulseStoryReplies.id, id),
          eq(cherishPulseStoryReplies.organizationId, organizationId),
          eq(cherishPulseStoryReplies.authorId, user.id),
          isNull(cherishPulseStoryReplies.deletedAt),
        ),
      )
      .get()
    if (!reply) {
      return { success: false, error: "That CHERISH reply was not found." }
    }

    await db
      .update(notificationEvents)
      .set({
        title: "CHERISH reply removed",
        body: "This reply was removed by its sender.",
      })
      .where(
        and(
          eq(notificationEvents.organizationId, organizationId),
          eq(notificationEvents.sourceType, "cherish_story_reply"),
          eq(notificationEvents.sourceId, id),
          eq(notificationEvents.createdBy, user.id),
        ),
      )
      .run()

    await db
      .update(cherishPulseStoryReplies)
      .set({ deletedAt: new Date().toISOString() })
      .where(
        and(
          eq(cherishPulseStoryReplies.id, id),
          eq(cherishPulseStoryReplies.organizationId, organizationId),
          eq(cherishPulseStoryReplies.authorId, user.id),
        ),
      )
      .run()

    revalidatePath("/dashboard/cherish")
    revalidatePath("/", "layout")
    return { success: true, data: { id } }
  } catch (error) {
    return storyError(error, "Unable to remove this CHERISH reply.")
  }
}

async function getCherishStories({
  activeOnly,
  limit,
}: {
  readonly activeOnly: boolean
  readonly limit: number
}): Promise<StoryActionResult<readonly CherishStory[]>> {
  try {
    const user = await requireAuth()
    if (!canViewCherishStories(user)) {
      return {
        success: false,
        error: "Only internal team members can view CHERISH stories.",
      }
    }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return {
        success: false,
        error: "Compass storage is not available right now.",
      }
    }

    const db = getDb(env.DB)
    const cutoff = new Date(Date.now() - STORY_WINDOW_MS).toISOString()
    const rows = await db
      .select({
        id: cherishPulseResponses.id,
        cherishValue: cherishPulseResponses.cherishValue,
        responseType: cherishPulseResponses.responseType,
        message: cherishPulseResponses.message,
        isAnonymous: cherishPulseResponses.isAnonymous,
        submittedByName: cherishPulseResponses.submittedByName,
        publishedAt: cherishPulseResponses.publishedAt,
      })
      .from(cherishPulseResponses)
      .where(
        and(
          eq(cherishPulseResponses.organizationId, organizationId),
          eq(cherishPulseResponses.visibility, "team"),
          eq(cherishPulseResponses.audienceScope, "company"),
          eq(cherishPulseResponses.reviewStatus, "approved"),
          activeOnly
            ? gte(cherishPulseResponses.publishedAt, cutoff)
            : undefined,
        ),
      )
      .orderBy(desc(cherishPulseResponses.publishedAt))
      .limit(limit)

    const storyRows = rows.flatMap((row) => {
      if (
        row.publishedAt === null ||
        (row.responseType !== "shoutout" && row.responseType !== "win")
      ) {
        return []
      }

      return [{ ...row, publishedAt: row.publishedAt }]
    })
    const storyIds = storyRows.map((row) => row.id)
    const [stateRows, reactionRows] = storyRows.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              responseId: cherishPulseStoryStates.responseId,
              viewedAt: cherishPulseStoryStates.viewedAt,
              reactedAt: cherishPulseStoryStates.reactedAt,
            })
            .from(cherishPulseStoryStates)
            .where(
              and(
                eq(cherishPulseStoryStates.organizationId, organizationId),
                eq(cherishPulseStoryStates.userId, user.id),
                inArray(cherishPulseStoryStates.responseId, storyIds),
              ),
            ),
          db
            .select({
              responseId: cherishPulseStoryStates.responseId,
              reactionCount: count(cherishPulseStoryStates.reactedAt),
            })
            .from(cherishPulseStoryStates)
            .where(
              and(
                eq(cherishPulseStoryStates.organizationId, organizationId),
                inArray(cherishPulseStoryStates.responseId, storyIds),
                isNotNull(cherishPulseStoryStates.reactedAt),
              ),
            )
            .groupBy(cherishPulseStoryStates.responseId),
        ])

    const statesByResponse = new Map(
      stateRows.map((state) => [state.responseId, state]),
    )
    const reactionsByResponse = new Map(
      reactionRows.map((reaction) => [
        reaction.responseId,
        reaction.reactionCount,
      ]),
    )
    return {
      success: true,
      data: storyRows.map((row): CherishStory => {
        const state = statesByResponse.get(row.id)
        return {
          id: row.id,
          cherishValue: row.cherishValue,
          responseType: row.responseType === "win" ? "win" : "shoutout",
          message: row.message,
          isAnonymous: row.isAnonymous,
          submittedByName: row.isAnonymous ? null : row.submittedByName,
          publishedAt: row.publishedAt,
          viewedAt: state?.viewedAt ?? null,
          reactedAt: state?.reactedAt ?? null,
          reactionCount: reactionsByResponse.get(row.id) ?? 0,
          audience: { scope: "company" },
        }
      }),
    }
  } catch (error) {
    return storyError(error, "Unable to load CHERISH stories.")
  }
}

async function storyMutationContext(
  rawId: string,
): Promise<
  | {
      readonly success: true
      readonly db: ReturnType<typeof getDb>
      readonly organizationId: string
      readonly responseId: string
      readonly recipientId: string | null
      readonly recipientEmail: string | null
      readonly user: AuthUser
    }
  | { readonly success: false; readonly error: string }
> {
  const user = await requireAuth()
  if (!canViewCherishStories(user)) {
    return {
      success: false,
      error: "Only internal team members can view CHERISH stories.",
    }
  }

  const responseId = rawId.trim()
  if (responseId.length === 0) {
    return { success: false, error: "Choose a CHERISH story." }
  }

  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  if (!env?.DB) {
    return {
      success: false,
      error: "Compass storage is not available right now.",
    }
  }

  const db = getDb(env.DB)
  const cutoff = new Date(Date.now() - STORY_WINDOW_MS).toISOString()
  const response = await db
    .select({
      id: cherishPulseResponses.id,
      recipientId: cherishPulseResponses.submittedBy,
      recipientEmail: cherishPulseResponses.submittedByEmail,
    })
    .from(cherishPulseResponses)
    .where(
      and(
        eq(cherishPulseResponses.id, responseId),
        eq(cherishPulseResponses.organizationId, organizationId),
        eq(cherishPulseResponses.visibility, "team"),
        eq(cherishPulseResponses.audienceScope, "company"),
        eq(cherishPulseResponses.reviewStatus, "approved"),
        gte(cherishPulseResponses.publishedAt, cutoff),
      ),
    )
    .get()

  if (!response) {
    return {
      success: false,
      error: "This CHERISH story is no longer available.",
    }
  }

  return {
    success: true,
    db,
    organizationId,
    responseId,
    recipientId: response.recipientId,
    recipientEmail: response.recipientEmail,
    user,
  }
}

function canViewCherishStories(user: AuthUser): boolean {
  return (
    user.isActive &&
    user.organizationType === "internal" &&
    isInternalStaffRole(user.role)
  )
}

function replyAuthorName(user: AuthUser): string {
  const displayName = user.displayName?.trim()
  if (displayName) return displayName
  const fullName = `${user.firstName?.trim() ?? ""} ${user.lastName?.trim() ?? ""}`.trim()
  return fullName || user.email
}

function storyError<T>(
  error: unknown,
  fallback: string,
): StoryActionResult<T> {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
  }
}
