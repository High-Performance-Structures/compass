import type { AgentMessage } from "@/lib/agent/message-types"

export const AGENT_REQUEST_MAX_MESSAGES = 100
export const AGENT_REQUEST_MAX_CONTENT_CHARACTERS = 20_000

export interface AgentRequestMessage {
  readonly role: "user" | "assistant"
  readonly content: string
}

function getMessageText(message: AgentMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("")
}

/**
 * Keep resumed conversations within the API contract. Saved conversations can
 * outlive changes to the message format and can grow beyond the request limit,
 * so only the newest compatible context is sent to Jarvis.
 */
export function buildAgentRequestMessages(
  messages: ReadonlyArray<AgentMessage>,
): ReadonlyArray<AgentRequestMessage> {
  const newestCompatibleMessages = messages
    .filter(
      (message) =>
        message.role === "user" || message.role === "assistant",
    )
    .slice(-AGENT_REQUEST_MAX_MESSAGES)

  // Anthropic requires the retained conversation to begin with a user turn.
  // The raw cap can otherwise split the oldest user/assistant pair in half.
  const firstUserIndex = newestCompatibleMessages.findIndex(
    (message) => message.role === "user",
  )
  if (firstUserIndex === -1) return []

  return newestCompatibleMessages
    .slice(firstUserIndex)
    .map((message) => ({
      role: message.role,
      content: getMessageText(message).slice(
        0,
        AGENT_REQUEST_MAX_CONTENT_CHARACTERS,
      ),
    }))
}
