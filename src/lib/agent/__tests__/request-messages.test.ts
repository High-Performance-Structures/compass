import { describe, expect, it } from "vitest"
import type { AgentMessage } from "@/lib/agent/message-types"
import {
  AGENT_REQUEST_MAX_CONTENT_CHARACTERS,
  AGENT_REQUEST_MAX_MESSAGES,
  buildAgentRequestMessages,
} from "@/lib/agent/request-messages"

function message(index: number, text = `message-${index}`): AgentMessage {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text }],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }
}

describe("buildAgentRequestMessages", () => {
  it("keeps the newest messages when a resumed conversation exceeds the API limit", () => {
    const messages = Array.from(
      { length: AGENT_REQUEST_MAX_MESSAGES + 5 },
      (_, index) => message(index),
    )

    const requestMessages = buildAgentRequestMessages(messages)

    expect(requestMessages).toHaveLength(AGENT_REQUEST_MAX_MESSAGES - 1)
    expect(requestMessages[0]?.role).toBe("user")
    expect(requestMessages[0]?.content).toBe("message-6")
    expect(requestMessages.at(-1)?.content).toBe("message-104")
  })

  it("limits oversized restored message content", () => {
    const requestMessages = buildAgentRequestMessages([
      message(0, "x".repeat(AGENT_REQUEST_MAX_CONTENT_CHARACTERS + 1)),
    ])

    expect(requestMessages[0]?.content).toHaveLength(
      AGENT_REQUEST_MAX_CONTENT_CHARACTERS,
    )
  })

  it("serializes only text parts", () => {
    const requestMessages = buildAgentRequestMessages([
      message(0, "Question"),
      {
        id: "message-with-tools",
        role: "assistant",
        parts: [
          { type: "text", text: "Done" },
          {
            type: "tool-result",
            toolCallId: "tool-1",
            result: { success: true },
            isError: false,
          },
        ],
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ])

    expect(requestMessages).toEqual([
      { role: "user", content: "Question" },
      { role: "assistant", content: "Done" },
    ])
  })
})
