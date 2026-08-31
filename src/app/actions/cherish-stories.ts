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
  or,
} from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { deleteMessage, sendMessage } from "@/app/actions/chat-messages"
import { createDirectMessage } from "@/app/actions/conversations"
import { getDb } from "@/db"
import {
  cherishPulseResponses,
  cherishPulseStoryReplies,
  cherishPulseStoryStates,
  notificationEvents,
} from "@/db/schema"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { conversationFullViewHref } from "@/lib/conversations/notification-route"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { isInternalStaffRole } from "@/lib/user-roles"

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
  readonly audience:
    | { readonly scope: "company" }
    | { readonly scope: "user" }
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

    const conversation = await createDirectMessage([context.recipientId])
    if (!conversation.success || !conversation.data) {
      return {
        success: false,
        error: "Unable to start a private conversation with the sender.",
      }
    }

    const sentMessage = await sendMessage({
      channelId: conversation.data.channelId,
      content: `CHERISH reply\n\n${message}`,
    })
    if (!sentMessage.success || !sentMessage.data) {
      return {
        success: false,
        error: "Unable to send this reply as a private message.",
      }
    }

    // Sharing the id links the CHERISH acknowledgement to the regular message
    // so Undo can remove both without adding another schema relationship.
    const id = sentMessage.data.id
    const now = new Date().toISOString()
    try {
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
    } catch (persistenceError) {
      const rollback = await deleteMessage(id)
      if (!rollback.success) {
        console.error("Unable to roll back an untracked CHERISH message:", {
          id,
          persistenceError,
          rollbackError: rollback.error,
        })
      } else {
        await context.db
          .update(notificationEvents)
          .set({
            title: "CHERISH reply not sent",
            body: "This reply could not be delivered.",
          })
          .where(
            and(
              eq(notificationEvents.organizationId, context.organizationId),
              eq(notificationEvents.sourceType, "message"),
              eq(notificationEvents.sourceId, id),
              eq(notificationEvents.createdBy, context.user.id),
            ),
          )
          .run()
      }
      return {
        success: false,
        error: "Unable to finish sending this reply. Please try again.",
      }
    }

    // The regular message notification already opens the correct conversation.
    // Customizing its CHERISH presentation is useful but not delivery-critical.
    try {
      await context.db
        .update(notificationEvents)
        .set({
          eventType: "cherish.story_reply",
          title: `${replyAuthorName(context.user)} replied to your CHERISH`,
          href: conversationFullViewHref(conversation.data.channelId),
        })
        .where(
          and(
            eq(notificationEvents.organizationId, context.organizationId),
            eq(notificationEvents.sourceType, "message"),
            eq(notificationEvents.sourceId, id),
            eq(notificationEvents.createdBy, context.user.id),
          ),
        )
        .run()
    } catch (notificationError) {
      console.error("Unable to customize the CHERISH reply notification:", {
        id,
        notificationError,
      })
    }

    revalidatePath("/dashboard/cherish")
    return { success: true, data: { id } }
  } catch (error) {
    return storyError(error, "Unable to send this CHERISH reply.")
  }
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

    const deletedMessage = await deleteMessage(id)
    if (!deletedMessage.success) {
      return {
        success: false,
        error: "Unable to remove the private message for this reply.",
      }
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
          eq(notificationEvents.sourceType, "message"),
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
        audienceScope: cherishPulseResponses.audienceScope,
        audienceReferenceId: cherishPulseResponses.audienceReferenceId,
      })
      .from(cherishPulseResponses)
      .where(
        and(
          eq(cherishPulseResponses.organizationId, organizationId),
          eq(cherishPulseResponses.visibility, "team"),
          or(
            eq(cherishPulseResponses.audienceScope, "company"),
            and(
              eq(cherishPulseResponses.audienceScope, "user"),
              eq(cherishPulseResponses.audienceReferenceId, user.id),
            ),
          ),
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
          audience:
            row.audienceScope === "user" &&
            row.audienceReferenceId === user.id
              ? { scope: "user" }
              : { scope: "company" },
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
        or(
          eq(cherishPulseResponses.audienceScope, "company"),
          and(
            eq(cherishPulseResponses.audienceScope, "user"),
            eq(cherishPulseResponses.audienceReferenceId, user.id),
          ),
        ),
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
