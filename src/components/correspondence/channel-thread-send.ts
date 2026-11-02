import { sendMessage } from "@/app/actions/chat-messages"
import { sendCorrespondence } from "@/app/actions/project-correspondence"
import { channelIdFromConversationId } from "@/lib/correspondence/channel-thread-id"
import type { SendCorrespondenceInput, SendCorrespondenceResult } from "@/lib/correspondence/types"

export { isChannelThreadId } from "@/lib/correspondence/channel-thread-id"

/**
 * Send from the project messages pane. Correspondence goes through
 * `sendCorrespondence` as before; a reply in an imported project conversation
 * (a channel) goes through the conversation's own `sendMessage`, so access,
 * mentions, unread counts and notifications are exactly the chat's.
 */
export async function sendFromProjectMessages(input: SendCorrespondenceInput): Promise<SendCorrespondenceResult> {
  const channelId = channelIdFromConversationId(input.conversationId)
  if (channelId === null || input.conversationId === null) return sendCorrespondence(input)
  if (input.attachmentIds.length > 0) {
    return { success: false, error: "Files can't be attached to a reply in an imported conversation yet. Remove them and send again.", retry: "edit" }
  }
  try {
    const result = await sendMessage({ channelId, content: input.body })
    if (!result.success || !("data" in result) || !result.data) {
      return { success: false, error: ("error" in result && result.error) || "The reply could not be sent.", retry: "edit" }
    }
    return { success: true, data: { conversationId: input.conversationId, messageId: result.data.id } }
  } catch {
    // sendMessage is not idempotent: never offer a blind retry of the same request.
    return { success: false, error: "The reply may not have been sent. Check the conversation before sending again.", retry: "edit" }
  }
}
