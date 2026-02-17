"use client"

/**
 * SSE event types from agent server (packages/agent-server/src/stream.ts)
 *
 * The agent server converts SDK messages into a flat SSE protocol:
 * - text: streaming text deltas
 * - tool_use: tool invocation with name, ID, and input
 * - tool_result: tool execution result
 * - tool_progress: optional progress updates during long-running tools
 * - result: final result with usage stats
 * - error: error message
 */
export type SSEEvent =
  | { readonly type: "text"; readonly content: string }
  | {
      readonly type: "tool_use"
      readonly name: string
      readonly toolCallId: string
      readonly input: unknown
    }
  | {
      readonly type: "tool_result"
      readonly toolCallId: string
      readonly output: unknown
    }
  | {
      readonly type: "tool_progress"
      readonly toolName: string
      readonly toolCallId: string
      readonly elapsedSeconds: number
    }
  | {
      readonly type: "result"
      readonly subtype: "success" | "error"
      readonly result: string
      readonly usage?: {
        readonly inputTokens: number
        readonly outputTokens: number
        readonly totalCostUsd: number
      }
    }
  | { readonly type: "error"; readonly error: string }

/**
 * Message format for the chat UI - designed to be compatible
 * with existing ChatMessage component rendering logic
 */
export interface AgentMessage {
  readonly id: string
  readonly role: "user" | "assistant"
  readonly parts: ReadonlyArray<AgentPart>
  readonly createdAt: Date
}

/**
 * Message parts that map to existing rendering patterns in chat-view.tsx
 * Each part type corresponds to a specific rendering style:
 * - text: normal message content (MessageResponse)
 * - tool-call: tool invocation display (Tool component)
 * - tool-result: tool output display (ToolOutput)
 * - reasoning: collapsible thinking block (Reasoning component)
 */
export type AgentPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool-call"
      readonly toolName: string
      readonly toolCallId: string
      readonly args: unknown
      readonly state: "partial-call" | "call" | "result"
    }
  | {
      readonly type: "tool-result"
      readonly toolCallId: string
      readonly result: unknown
      readonly isError: boolean
    }
  | {
      readonly type: "reasoning"
      readonly text: string
      readonly state: "streaming" | "complete"
    }
