import type Anthropic from "@anthropic-ai/sdk"
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages"
import { createClient } from "./client"
import type { ProviderConfig, SSEData } from "./types"
import type { ToolDef } from "./tools"
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
  const client = createClient(opts.provider)
  const maxTurns = opts.maxTurns ?? 25

  // Mutable messages array for the agentic loop
  const messages: Anthropic.MessageParam[] = opts.messages.map(
    (m) => ({
      role: m.role,
      content: m.content,
    })
  )

  // Build tool map for execution and API tool definitions
  const toolMap = new Map<
    string,
    (input: unknown) => Promise<string> | string
  >()
  const apiTools: Tool[] = []

  // Register direct tools first (they take priority)
  if (opts.tools) {
    for (const tool of opts.tools) {
      toolMap.set(tool.name, tool.run)
      apiTools.push({
        name: tool.name,
        description: tool.description,
        input_schema:
          tool.input_schema as Tool.InputSchema,
      })
    }
  }

  // Register MCP tools (skip if already provided as direct)
  const mcpManager = opts.mcpClientManager
  if (mcpManager) {
    for (const tool of mcpManager.listTools()) {
      if (toolMap.has(tool.name)) continue
      apiTools.push({
        name: tool.name,
        description: tool.description,
        input_schema:
          tool.input_schema as Tool.InputSchema,
      })
    }
  }

  // OAuth endpoint requires mcp_ prefix on tool names
  const effectiveTools: Tool[] = opts.isOAuth
    ? apiTools.map((t) => ({ ...t, name: `mcp_${t.name}` }))
    : apiTools

  let turn = 0

  while (turn < maxTurns) {
    turn++

    try {
      const stream = client.messages.stream({
        model: opts.model,
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

        const runFn = toolMap.get(toolName)

        // Route: direct tool -> MCP manager -> unknown
        if (!runFn && !mcpManager) {
          const errorResult = JSON.stringify({
            error: `Unknown tool: ${toolName}`,
          })
          yield {
            type: "tool_result",
            toolCallId: block.id,
            output: errorResult,
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: errorResult,
            is_error: true,
          })
          continue
        }

        try {
          let result: string
          if (runFn) {
            result = await runFn(block.input)
          } else if (mcpManager) {
            result = await mcpManager.callTool(
              toolName,
              block.input
            )
          } else {
            result = JSON.stringify({
              error: `Unknown tool: ${toolName}`,
            })
          }
          let parsed: unknown
          try {
            parsed = JSON.parse(result)
          } catch {
            parsed = result
          }
          yield {
            type: "tool_result",
            toolCallId: block.id,
            output: parsed,
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          })
        } catch (err) {
          const errorMsg =
            err instanceof Error
              ? err.message
              : String(err)
          yield {
            type: "tool_result",
            toolCallId: block.id,
            output: { error: errorMsg },
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ error: errorMsg }),
            is_error: true,
          })
        }
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
