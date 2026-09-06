"use server"

import { and, eq, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import {
  correspondenceRecipients,
  correspondenceState,
} from "@/db/schema-correspondence"
import {
  authorizedConversation,
  correspondenceContext,
} from "@/lib/correspondence/access"
import type { CorrespondenceResult } from "@/lib/correspondence/types"

export async function updateCorrespondenceInbox(
  projectId: string,
  conversationIds: readonly string[],
  action:
    | "read"
    | "archive"
    | "restore"
    | "follow-up"
    | "clear-follow-up"
    | "save"
    | "unsave",
): Promise<CorrespondenceResult<null>> {
  try {
    if (
      !Array.isArray(conversationIds) ||
      conversationIds.length === 0 ||
      conversationIds.length > 100 ||
      conversationIds.some((id) => typeof id !== "string" || !id.trim()) ||
      ![
        "read",
        "archive",
        "restore",
        "follow-up",
        "clear-follow-up",
        "save",
        "unsave",
      ].includes(action)
    ) {
      return {
        success: false,
        error: "Choose up to 100 conversations and a valid inbox action.",
      }
    }
    const ids = [...new Set(conversationIds)]
    const ctx = await correspondenceContext(projectId)
    // Authorize the entire selection before any write; a forged ID cannot cause a partial update.
    for (const id of ids) await authorizedConversation(ctx, id)
    const now = new Date().toISOString()
    const statePatch =
      action === "save" || action === "unsave"
        ? { saved: action === "save" }
        : action === "follow-up" || action === "clear-follow-up"
          ? { followUp: action === "follow-up" }
          : { archived: action === "archive" }
    const writes = ids.map((conversationId) =>
      action === "read"
        ? ctx.db
            .update(correspondenceRecipients)
            .set({ openedAt: now })
            .where(
              and(
                eq(correspondenceRecipients.userId, ctx.user.id),
                isNull(correspondenceRecipients.openedAt),
                eq(correspondenceRecipients.baseline, false),
                sql`EXISTS (SELECT 1 FROM correspondence_messages m JOIN correspondence_participants p ON p.conversation_id=m.conversation_id
            WHERE m.id=correspondence_recipients.message_id AND m.conversation_id=${conversationId}
            AND p.user_id=${ctx.user.id} AND p.revoked_at IS NULL AND m.retracted_at IS NULL
            AND (m.author_user_id IS NULL OR m.author_user_id<>${ctx.user.id})
            AND m.sent_at<=${now} AND (m.edited_at IS NULL OR m.edited_at<=${now}))`,
              ),
            )
        : ctx.db
            .insert(correspondenceState)
            .values({
              id: crypto.randomUUID(),
              conversationId,
              userId: ctx.user.id,
              ...statePatch,
            })
            .onConflictDoUpdate({
              target: [
                correspondenceState.conversationId,
                correspondenceState.userId,
              ],
              set: statePatch,
            }),
    )
    const [first, ...rest] = writes
    if (first) await ctx.db.batch([first, ...rest])
    revalidatePath(`/dashboard/projects/${projectId}/messages`)
    revalidatePath(`/preview/projects/${projectId}/owner/conversations`)
    revalidatePath(`/preview/projects/${projectId}/sub-vendor/conversations`)
    return { success: true, data: null }
  } catch {
    return {
      success: false,
      error:
        "Unable to update the selected conversations. Refresh and try again.",
    }
  }
}
