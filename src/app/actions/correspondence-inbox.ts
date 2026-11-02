"use server"

import { revalidatePath } from "next/cache"
import {
  authorizedConversation,
  correspondenceContext,
} from "@/lib/correspondence/access"
import { channelIdFromConversationId, CHANNEL_THREAD_STATE_UNAVAILABLE } from "@/lib/correspondence/channel-thread-id"
import { markChannelThreadsRead } from "@/lib/correspondence/channel-threads"
import type { CorrespondenceResult } from "@/lib/correspondence/types"
import { inboxStatePatch } from "@/lib/domain/correspondence/rules"
import { markConversationReadStatement, upsertConversationStateStatement } from "@/lib/domain/correspondence/store"

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
    const selection = [...new Set(conversationIds)]
    // Imported project conversations (channels) keep only read state; other inbox state is correspondence-only.
    const channelIds = selection.flatMap((id) => channelIdFromConversationId(id) ?? [])
    const ids = selection.filter((id) => channelIdFromConversationId(id) === null)
    if (channelIds.length > 0 && action !== "read") {
      return { success: false, error: `${CHANNEL_THREAD_STATE_UNAVAILABLE} Deselect them and try again.` }
    }
    const ctx = await correspondenceContext(projectId)
    // Authorize the entire selection before any write; a forged ID cannot cause a partial update.
    for (const id of ids) await authorizedConversation(ctx, id)
    if (channelIds.length > 0) await markChannelThreadsRead(ctx, channelIds)
    const now = new Date().toISOString()
    const writes = ids.map((conversationId) =>
      action === "read"
        ? markConversationReadStatement(ctx.db, { userId: ctx.user.id, conversationId, now })
        : upsertConversationStateStatement(ctx.db, conversationId, ctx.user.id, inboxStatePatch(action)),
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
