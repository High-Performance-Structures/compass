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

  it("drops failed exchanges so the newest question is the one answered", () => {
    const failedReply = (id: string): AgentMessage => ({
      id,
      role: "assistant",
      parts: [],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    })
    const user = (id: string, text: string): AgentMessage => ({
      id,
      role: "user",
      parts: [{ type: "text", text }],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    })

    const requestMessages = buildAgentRequestMessages([
      user("q0", "What changed today?"),
      { ...message(1, "Two daily logs were filed."), id: "a0" },
      user("q1", "Any recent daily logs?"),
      failedReply("a1"),
      user("q2", "Any recent daily logs?"),
      failedReply("a2"),
      user("q3", "Any messages for me?"),
    ])

    expect(requestMessages).toEqual([
      { role: "user", content: "What changed today?" },
      { role: "assistant", content: "Two daily logs were filed." },
      { role: "user", content: "Any messages for me?" },
    ])
  })

  it("keeps a reply that only made a tool call", () => {
    const requestMessages = buildAgentRequestMessages([
      { ...message(0, "Make it dark"), id: "q" },
      {
        id: "a",
        role: "assistant",
        parts: [{ type: "tool-call", toolName: "setTheme", toolCallId: "c1", args: {}, state: "result" }],
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      { ...message(2, "Thanks"), id: "q2" },
    ])

    expect(requestMessages.map((m) => m.content)).toEqual(["Make it dark", "", "Thanks"])
  })
})
