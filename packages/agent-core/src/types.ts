export interface ProviderConfig {
  readonly type: "anthropic" | "openrouter" | "ollama" | "custom"
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly modelOverrides?: Readonly<Record<string, string>>
}

export interface AgentContext {
  readonly userId: string
  readonly orgId: string
  readonly role: string
  readonly isDemoUser: boolean
  readonly currentPage: string
  readonly timezone: string
}

/** Abstracts HTTP calls vs direct DB access for tools */
export interface DataSource {
  fetch(path: string, body?: unknown): Promise<unknown>
}

/** SSE events emitted by the agentic loop */
export type SSEData =
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
      readonly type: "result"
      readonly subtype: string
      readonly result: string
      readonly usage?: {
        readonly inputTokens: number
        readonly outputTokens: number
        readonly totalCostUsd: number
      }
    }
  | { readonly type: "error"; readonly error: string }
