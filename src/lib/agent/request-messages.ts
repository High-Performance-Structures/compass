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

// A reply with no text and no tool calls is what a failed request leaves
// behind (the chat appends an empty assistant message before streaming).
function isFailedReply(message: AgentMessage): boolean {
  return (
    message.role === "assistant" &&
    getMessageText(message).trim().length === 0 &&
    !message.parts.some((part) => part.type === "tool-call")
  )
}

/**
 * Drops each failed reply together with the question it failed to answer.
 * Otherwise retries pile up unanswered questions and the model may answer an
 * older one instead of the newest.
 */
function withoutFailedExchanges(
  messages: ReadonlyArray<AgentMessage>,
): ReadonlyArray<AgentMessage> {
  const kept: AgentMessage[] = []
  for (const message of messages) {
    if (isFailedReply(message)) {
      if (kept.at(-1)?.role === "user") kept.pop()
      continue
    }
    kept.push(message)
  }
  return kept
}

/**
 * Keep resumed conversations within the API contract. Saved conversations can
 * outlive changes to the message format and can grow beyond the request limit,
 * so only the newest compatible context is sent to Jarvis.
 */
export function buildAgentRequestMessages(
  messages: ReadonlyArray<AgentMessage>,
): ReadonlyArray<AgentRequestMessage> {
  const newestCompatibleMessages = withoutFailedExchanges(messages)
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
