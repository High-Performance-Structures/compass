import { describe, expect, it } from "vitest"
import {
  createAgentRelayResponse,
  isJarvisAgentBridgeEnabled,
  parseAgentRelayResult,
  relayMessages,
} from "@/lib/jarvis/agent-relay"

describe("Jarvis agent relay", () => {
  it("recognizes explicit enabled values only", () => {
    expect(isJarvisAgentBridgeEnabled("true")).toBe(true)
    expect(isJarvisAgentBridgeEnabled(" ON ")).toBe(true)
    expect(isJarvisAgentBridgeEnabled("false")).toBe(false)
    expect(isJarvisAgentBridgeEnabled(undefined)).toBe(false)
  })

  it("limits relayed history and individual message length", () => {
    const messages = Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `${index}:message`,
    }))

    const relayed = relayMessages(messages)

    expect(relayed).toHaveLength(20)
    expect(relayed[0]?.content.startsWith("4:")).toBe(true)
    expect(relayed[19]?.content.startsWith("23:")).toBe(true)

    const longMessage = relayMessages([
      { role: "user", content: "x".repeat(5_000) },
    ])
    expect(longMessage[0]?.content).toHaveLength(4_000)
  })

  it("keeps the newest messages within the bridge response budget", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `${index}:${"x".repeat(4_998)}`,
    }))

    const relayed = relayMessages(messages)
    const characters = relayed.reduce(
      (total, message) => total + message.content.length,
      0,
    )

    expect(characters).toBe(32_000)
    expect(relayed.at(-1)?.content.startsWith("9:")).toBe(true)
  })

  it("extracts only a non-empty response", () => {
    expect(
      parseAgentRelayResult(
        JSON.stringify({ content: "Hello from Jarvis" }),
      ),
    ).toBe("Hello from Jarvis")
    expect(
      parseAgentRelayResult(JSON.stringify({ content: "  " })),
    ).toBeNull()
    expect(parseAgentRelayResult("not-json")).toBeNull()
  })

  it("returns the SSE protocol consumed by the Compass agent hook", async () => {
    const response = createAgentRelayResponse("Hello")
    const body = await response.text()

    expect(response.headers.get("Content-Type")).toBe(
      "text/event-stream",
    )
    expect(body).toContain(
      'data: {"type":"text","content":"Hello"}',
    )
    expect(body).toContain(
      'data: {"type":"result","subtype":"success","result":"Hello"}',
    )
    expect(body).toContain("data: [DONE]")
  })
})
