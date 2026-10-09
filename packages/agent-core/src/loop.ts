import type Anthropic from "@anthropic-ai/sdk"
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages"
import { createClient } from "./client"
import { isAnthropicFormatProvider } from "./types"
import type { ProviderConfig, SSEData } from "./types"
import { runOpenAIAgent } from "./openai-loop"
import type { ToolDef } from "./tools"
import { createToolRegistry } from "./tool-registry"
import type { McpClientManager } from "./mcp/types"

interface AgentOptions {
  readonly provider: ProviderConfig
  readonly model: string
  readonly systemPrompt: string
  readonly messages: ReadonlyArray<{
    role: "user" | "assistant"
    content: string
  }>
  readonly tools?: readonly ToolDef[]
  readonly mcpClientManager?: McpClientManager
  readonly maxTurns?: number
  readonly isOAuth?: boolean
}

export async function* runAgent(
  opts: AgentOptions
): AsyncGenerator<SSEData> {
  const maxTurns = opts.maxTurns ?? 25
  const registry = createToolRegistry(opts.tools, opts.mcpClientManager)
  const resolvedModel =
    opts.provider.modelOverrides?.[opts.model] ?? opts.model

  // OpenAI does not speak Anthropic's Messages format, so it gets its own loop.
  if (!isAnthropicFormatProvider(opts.provider)) {
    if (!opts.provider.apiKey) {
      yield { type: "error", error: "The OpenAI provider has no API key." }
      return
    }
    yield* runOpenAIAgent({
      apiKey: opts.provider.apiKey,
      baseUrl: opts.provider.baseUrl,
      model: resolvedModel,
      systemPrompt: opts.systemPrompt,
      messages: opts.messages,
      registry,
      maxTurns,
    })
    return
  }

  const client = createClient(opts.provider)

  // Mutable messages array for the agentic loop
  const messages: Anthropic.MessageParam[] = opts.messages.map(
    (m) => ({
      role: m.role,
      content: m.content,
    })
  )

  const apiTools: Tool[] = registry.apiTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: "object", ...t.input_schema },
  }))

  // OAuth endpoint requires mcp_ prefix on tool names
  const effectiveTools: Tool[] = opts.isOAuth
    ? apiTools.map((t) => ({ ...t, name: `mcp_${t.name}` }))
    : apiTools

  let turn = 0

  while (turn < maxTurns) {
    turn++

    try {
      const stream = client.messages.stream({
        model: resolvedModel,
        max_tokens: 8192,
        system: opts.systemPrompt,
        messages,
        tools: effectiveTools,
      })

      // Stream text deltas and tool_use starts to the caller
      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block
          if (block.type === "tool_use") {
            const displayName =
              opts.isOAuth && block.name.startsWith("mcp_")
                ? block.name.slice(4)
                : block.name
            yield {
              type: "tool_use",
              name: displayName,
              toolCallId: block.id,
              input: {},
            }
          }
        }

        if (event.type === "content_block_delta") {
          const delta = event.delta
          if (
            "text" in delta &&
            delta.type === "text_delta"
          ) {
            yield { type: "text", content: delta.text }
          }
        }
      }

      const message = await stream.finalMessage()

      // No tool calls — we're done
      if (message.stop_reason !== "tool_use") {
        yield {
          type: "result",
          subtype: "success",
          result: message.content
            .filter(
              (b): b is Anthropic.TextBlock =>
                b.type === "text"
            )
            .map((b) => b.text)
            .join(""),
          usage: message.usage
            ? {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
                totalCostUsd: 0,
              }
            : undefined,
        }
        return
      }

      // Execute tool calls and continue the loop
      messages.push({
        role: "assistant",
        content: message.content,
      })

      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of message.content) {
        if (block.type !== "tool_use") continue

        // Strip mcp_ prefix from OAuth tool calls for local dispatch
        const toolName =
          opts.isOAuth && block.name.startsWith("mcp_")
            ? block.name.slice(4)
            : block.name

        const outcome = await registry.execute(toolName, block.input)
        yield {
          type: "tool_result",
          toolCallId: block.id,
          output: outcome.output,
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        })
      }

      messages.push({ role: "user", content: toolResults })
    } catch (err) {
      yield {
        type: "error",
        error:
          err instanceof Error ? err.message : String(err),
      }
      return
    }
  }

  // Max turns reached
  yield {
    type: "result",
    subtype: "success",
    result: "Max turns reached",
    usage: undefined,
  }
}
