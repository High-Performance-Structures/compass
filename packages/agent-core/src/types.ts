export interface ProviderConfig {
  readonly type: "anthropic" | "openrouter" | "ollama" | "custom" | "openai"
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly modelOverrides?: Readonly<Record<string, string>>
  /** OpenAI only: sent as reasoning_effort. Some models accept tools on
   *  Chat Completions only with "none". */
  readonly reasoningEffort?: string
}

/** Providers reached through the Anthropic SDK (Messages format). */
export type AnthropicFormatProvider = ProviderConfig & {
  readonly type: Exclude<ProviderConfig["type"], "openai">
}

export function isAnthropicFormatProvider(
  provider: ProviderConfig,
): provider is AnthropicFormatProvider {
  return provider.type !== "openai"
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
