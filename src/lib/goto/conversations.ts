import "server-only"

import { gotoConversationDeleteUrl } from "@/lib/goto/conversation-url"
import { getGotoAccessToken } from "@/lib/notifications/create-event"

export type DeleteGotoConversationResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

export async function deleteGotoConversation(input: {
  readonly env: unknown
  readonly ownerPhoneNumber: string
  readonly contactPhoneNumber: string
}): Promise<DeleteGotoConversationResult> {
  const url = gotoConversationDeleteUrl(input)
  if (!url) {
    return { success: false, error: "GoTo requires valid E.164 phone numbers." }
  }

  const token = await getGotoAccessToken(input.env)
  if (!token.success) return token

  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token.accessToken}` },
  })
  if (response.ok) return { success: true }

  const detail = (await response.text()).trim().slice(0, 500)
  return {
    success: false,
    error: detail || `GoTo conversation deletion failed (${response.status}).`,
  }
}
