/**
 * Local type definitions that replace AI SDK type imports.
 * These match the shapes the shadcn AI components actually use.
 */

export type ChatStatus =
  | "streaming"
  | "submitted"
  | "ready"
  | "error"

export interface LanguageModelUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly cachedInputTokens?: number
  readonly reasoningTokens?: number
  readonly inputTokenDetails?: {
    readonly noCacheTokens?: number
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
  }
  readonly outputTokenDetails?: {
    readonly textTokens?: number
    readonly reasoningTokens?: number
  }
}

export interface FileUIPart {
  readonly type: "file"
  readonly name?: string
  readonly filename?: string
  readonly mediaType: string
  readonly url: string
}

export interface ToolUIPart {
  readonly type: string
  readonly toolCallId: string
  readonly toolName: string
  readonly args: unknown
  readonly state: string
  readonly result?: unknown
}

export interface UIMessage {
  readonly id: string
  readonly role: "user" | "assistant" | "system"
  readonly parts: ReadonlyArray<Record<string, unknown>>
  readonly createdAt?: Date
}

export interface GeneratedImage {
  readonly base64?: string
  readonly uint8Array?: Uint8Array
  readonly mediaType?: string
}
