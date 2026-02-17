"use client"

import type { AgentMessage } from "@/lib/agent/message-types"

/**
 * Transport abstraction for agent communication
 * Supports both SSE (web/mobile) and WebSocket (desktop bridge)
 */
export interface AgentTransport {
  sendMessages(options: {
    messages: ReadonlyArray<AgentMessage>
    headers?: Record<string, string>
    signal?: AbortSignal
  }): Promise<ReadableStream<Uint8Array>>
}

/**
 * SSE transport for agent server
 */
export class AgentSSETransport implements AgentTransport {
  constructor(
    private readonly config: {
      url: string
      getAuthToken: () => Promise<string>
    }
  ) {}

  async sendMessages(options: {
    messages: ReadonlyArray<AgentMessage>
    headers?: Record<string, string>
    signal?: AbortSignal
  }): Promise<ReadableStream<Uint8Array>> {
    const token = await this.config.getAuthToken()

    const response = await fetch(`${this.config.url}/agent/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
      body: JSON.stringify({
        messages: options.messages.map((m) => ({
          role: m.role,
          content: m.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as { text: string }).text)
            .join(""),
        })),
      }),
      signal: options.signal,
    })

    if (!response.ok) {
      throw new Error(`Agent server error: ${response.status}`)
    }

    if (!response.body) {
      throw new Error("No response body")
    }

    return response.body
  }
}
