import type { SSEData } from "./types"
import type { ToolRegistry } from "./tool-registry"

// Native OpenAI Chat Completions loop. The Anthropic SDK used by the other
// providers speaks Anthropic's Messages format, which OpenAI does not accept,
// so this loop talks to OpenAI directly over fetch (Workers-compatible) and
// emits the same SSE events as runAgent.

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"

type ChatMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | {
      readonly role: "assistant"
      readonly content: string | null
      readonly tool_calls?: readonly OpenAIToolCall[]
    }
  | {
      readonly role: "tool"
      readonly tool_call_id: string
      readonly content: string
    }

interface OpenAIToolCall {
  readonly id: string
  readonly type: "function"
  readonly function: { readonly name: string; readonly arguments: string }
}

interface PendingToolCall {
  id: string
  name: string
  arguments: string
  announced: boolean
}

export interface OpenAIAgentOptions {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly systemPrompt: string
  readonly messages: ReadonlyArray<{
    readonly role: "user" | "assistant"
    readonly content: string
  }>
  readonly registry: ToolRegistry
  readonly maxTurns: number
  readonly fetchImpl?: typeof globalThis.fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const field = value[key]
  return typeof field === "string" ? field : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined
  const field = value[key]
  return typeof field === "number" ? field : undefined
}

/** Yields the JSON payload of each `data:` line in an SSE byte stream. */
async function* readSSEData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
    // Events may be split across chunks; keep the unfinished tail.
    const lines = buffer.split(/\r?\n/)
    buffer = done ? "" : (lines.pop() ?? "")
    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (data.length > 0) yield data
    }
    if (done) return
  }
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "")
  try {
    const parsed: unknown = JSON.parse(text)
    const error = isRecord(parsed) ? parsed.error : undefined
    const message = stringField(error, "message")
    if (message) return `OpenAI request failed (${response.status}): ${message}`
  } catch {
    // Fall through to the raw status.
  }
  return `OpenAI request failed (${response.status})`
}

export async function* runOpenAIAgent(
  opts: OpenAIAgentOptions,
): AsyncGenerator<SSEData> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const url = `${(opts.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "")}/chat/completions`
  const tools = opts.registry.apiTools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: "object", ...tool.input_schema },
    },
  }))

  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt },
    ...opts.messages.map((m): ChatMessage =>
      m.role === "user"
        ? { role: "user", content: m.content }
        : { role: "assistant", content: m.content },
    ),
  ]

  let inputTokens = 0
  let outputTokens = 0

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: 8192,
          ...(opts.reasoningEffort
            ? { reasoning_effort: opts.reasoningEffort }
            : {}),
          ...(tools.length > 0 ? { tools } : {}),
        }),
      })
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      }
      return
    }

    if (!response.ok || !response.body) {
      yield { type: "error", error: await errorMessage(response) }
      return
    }

    let text = ""
    let finishReason: string | undefined
    // Tool calls stream in pieces keyed by index: the id and name arrive
    // first, then the JSON arguments in fragments.
    const pending = new Map<number, PendingToolCall>()

    for await (const data of readSSEData(response.body)) {
      if (data === "[DONE]") break
      let chunk: unknown
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      if (!isRecord(chunk)) continue

      const usage = chunk.usage
      inputTokens += numberField(usage, "prompt_tokens") ?? 0
      outputTokens += numberField(usage, "completion_tokens") ?? 0

      const choices = Array.isArray(chunk.choices) ? chunk.choices : []
      const choice: unknown = choices[0]
      if (!isRecord(choice)) continue
      finishReason = stringField(choice, "finish_reason") ?? finishReason

      const delta = choice.delta
      const content = stringField(delta, "content")
      if (content) {
        text += content
        yield { type: "text", content }
      }

      const toolCalls =
        isRecord(delta) && Array.isArray(delta.tool_calls) ? delta.tool_calls : []
      for (const call of toolCalls) {
        const index = numberField(call, "index") ?? 0
        const existing = pending.get(index)
        const entry: PendingToolCall = existing ?? {
          id: "",
          name: "",
          arguments: "",
          announced: false,
        }
        entry.id = stringField(call, "id") ?? entry.id
        const fn = isRecord(call) ? call.function : undefined
        entry.name += stringField(fn, "name") ?? ""
        entry.arguments += stringField(fn, "arguments") ?? ""
        pending.set(index, entry)

        if (!entry.announced && entry.id && entry.name) {
          entry.announced = true
          yield {
            type: "tool_use",
            name: entry.name,
            toolCallId: entry.id,
            input: {},
          }
        }
      }
    }

    const calls = [...pending.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)
      .filter((call) => call.id && call.name)

    if (finishReason !== "tool_calls" || calls.length === 0) {
      yield {
        type: "result",
        subtype: "success",
        result: text,
        usage: { inputTokens, outputTokens, totalCostUsd: 0 },
      }
      return
    }

    messages.push({
      role: "assistant",
      content: text.length > 0 ? text : null,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    })

    for (const call of calls) {
      let input: unknown
      try {
        input = call.arguments.trim().length > 0 ? JSON.parse(call.arguments) : {}
      } catch {
        const error = `Invalid JSON arguments for ${call.name}`
        const content = JSON.stringify({ error })
        yield { type: "tool_result", toolCallId: call.id, output: { error } }
        messages.push({ role: "tool", tool_call_id: call.id, content })
        continue
      }
      const outcome = await opts.registry.execute(call.name, input)
      yield { type: "tool_result", toolCallId: call.id, output: outcome.output }
      messages.push({ role: "tool", tool_call_id: call.id, content: outcome.content })
    }
  }

  yield {
    type: "result",
    subtype: "success",
    result: "Max turns reached",
    usage: undefined,
  }
}
