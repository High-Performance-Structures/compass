/**
 * SSE streaming wrapper for Anthropic Agent SDK
 *
 * The SDK's query() yields SDKMessage union types:
 * - SDKAssistantMessage (type: "assistant") — completed message with content blocks
 * - SDKPartialAssistantMessage (type: "stream_event") — streaming deltas
 * - SDKResultMessage (type: "result") — final result with usage
 * - SDKToolProgressMessage (type: "tool_progress") — tool execution status
 * - SDKSystemMessage, SDKStatusMessage, etc. — internal, not forwarded
 *
 * We convert these into a flat SSE protocol the browser can consume:
 *   data: {"type":"text_delta","content":"Hello"}
 *   data: {"type":"tool_use","name":"queryData","toolCallId":"...","input":{}}
 *   data: {"type":"tool_result","toolCallId":"...","output":{}}
 *   data: {"type":"result","subtype":"success","result":"...","usage":{}}
 *   data: {"type":"error","error":"..."}
 *   data: [DONE]
 */

import {
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import type { MessageParam } from "@anthropic-ai/sdk/resources"
import type {
  BetaRawContentBlockStartEvent,
  BetaRawContentBlockDeltaEvent,
} from "@anthropic-ai/sdk/resources/beta/messages/messages"
import type { AuthContext, ProviderConfig } from "./auth"
import { createCompassMcpServer } from "./mcp/compass-server"
import { config } from "./config"

interface Message {
  role: "user" | "assistant"
  content: string
}

interface StreamContext {
  auth: AuthContext
  authToken: string
  sessionId: string
  currentPage: string
  timezone: string
  provider?: ProviderConfig
  model: string
}

/**
 * Convert messages array to async generator (required by SDK when using MCP).
 * Only yields the LAST user message — earlier conversation history is
 * injected into the system prompt so the model has context without
 * the SDK re-processing old turns.
 */
async function* createPromptGenerator(
  messages: readonly Message[],
  sessionId: string,
): AsyncGenerator<SDKUserMessage> {
  // find the last user message
  const lastUser = [...messages].reverse().find((m) => m.role === "user")
  if (!lastUser) return

  const messageParam: MessageParam = {
    role: "user",
    content: lastUser.content,
  }

  yield {
    type: "user" as const,
    message: messageParam,
    parent_tool_use_id: null,
    session_id: sessionId,
  }
}

/**
 * Build conversation history block for the system prompt.
 * Includes all messages EXCEPT the last user message (which is
 * yielded separately via the prompt generator).
 */
function buildConversationHistory(messages: readonly Message[]): string {
  // everything except the final user message
  const history = messages.slice(0, -1)
  if (history.length === 0) return ""

  const lines = history.map((m) => {
    const role = m.role === "user" ? "User" : "Assistant"
    return `${role}: ${m.content}`
  })

  return `\n\nConversation so far:\n${lines.join("\n")}\n\nContinue the conversation naturally.`
}

function buildSystemPrompt(
  context: StreamContext,
  messages: readonly Message[],
): string {
  const history = buildConversationHistory(messages)

  return `You are Compass AI, an intelligent assistant for project management and collaboration.

Current context:
- User ID: ${context.auth.userId}
- Organization: ${context.auth.orgId}
- Role: ${context.auth.role}
- Current page: ${context.currentPage}
- Timezone: ${context.timezone}

You have access to tools via the compass MCP server for querying data, navigating the UI, managing schedules, themes, memories, skills, dashboards, and GitHub integration.

When a tool returns an "action" field in its result, that action will be forwarded to the client for execution (navigation, toasts, UI generation, theme changes, etc.). You don't need to do anything extra — just call the tool and the action dispatches automatically.${history}`
}

/**
 * SSE helpers — each function returns a JSON string to send as a data: line
 */
function sseTextDelta(content: string): string {
  return JSON.stringify({ type: "text", content })
}

function sseToolUse(name: string, toolCallId: string, input: unknown): string {
  return JSON.stringify({ type: "tool_use", name, toolCallId, input })
}

function sseToolResult(toolCallId: string, output: unknown): string {
  return JSON.stringify({ type: "tool_result", toolCallId, output })
}

function sseResult(
  subtype: string,
  result: string,
  usage?: { inputTokens: number; outputTokens: number; totalCostUsd: number },
): string {
  return JSON.stringify({ type: "result", subtype, result, usage })
}

function sseError(error: string): string {
  return JSON.stringify({ type: "error", error })
}

/**
 * Extract SSE events from an SDKMessage.
 * Returns an array because one SDK message can produce multiple SSE events
 * (e.g. an assistant message with text + tool_use blocks).
 */
function extractSSEEvents(message: SDKMessage, emittedToolIds?: Set<string>): string[] {
  const events: string[] = []

  switch (message.type) {
    // Completed assistant message — SKIP all content blocks.
    // Text is already streamed via stream_event text_delta.
    // Tool use starts are already streamed via content_block_start.
    // Tool results come through user messages (see case "user" below).
    case "assistant":
      break

    // Streaming delta — text chunks and tool use starts
    case "stream_event": {
      const event = message.event
      if (!event) break

      if (event.type === "content_block_start") {
        const startEvent = event as BetaRawContentBlockStartEvent
        const block = startEvent.content_block
        if (block && "type" in block) {
          if ((block.type === "tool_use" || block.type === "mcp_tool_use") && "id" in block) {
            const tb = block as { id: string; name: string; input: unknown }
            if (!emittedToolIds?.has(tb.id)) {
              emittedToolIds?.add(tb.id)
              events.push(sseToolUse(tb.name, tb.id, tb.input ?? {}))
            }
          }
        }
      }

      if (event.type === "content_block_delta") {
        const deltaEvent = event as BetaRawContentBlockDeltaEvent
        const delta = deltaEvent.delta
        if (delta && "type" in delta) {
          if (delta.type === "text_delta" && "text" in delta) {
            events.push(sseTextDelta(delta.text as string))
          }
          // input_json_delta — partial tool input, skip for now
          // (the full input comes in content_block_start or assistant message)
        }
      }
      break
    }

    // Final result
    case "result": {
      if (message.subtype === "success") {
        events.push(sseResult(
          "success",
          (message as { result?: string }).result ?? "",
          {
            inputTokens: message.usage?.input_tokens ?? 0,
            outputTokens: message.usage?.output_tokens ?? 0,
            totalCostUsd: (message as { total_cost_usd?: number }).total_cost_usd ?? 0,
          },
        ))
      } else {
        const errMsg = message as { errors?: string[] }
        events.push(sseError(
          errMsg.errors?.join("; ") ?? `Agent error: ${message.subtype}`,
        ))
      }
      break
    }

    // Tool progress — optional, forward as status
    case "tool_progress": {
      const tp = message as {
        tool_name: string
        tool_use_id: string
        elapsed_time_seconds: number
      }
      events.push(JSON.stringify({
        type: "tool_progress",
        toolName: tp.tool_name,
        toolCallId: tp.tool_use_id,
        elapsedSeconds: tp.elapsed_time_seconds,
      }))
      break
    }

    // User messages contain tool results from MCP tool execution.
    // The SDK sends tool_result blocks inside user messages after
    // executing MCP tools. We need to forward these to the client
    // so action payloads (navigate, toast, etc.) get dispatched.
    case "user": {
      const userMsg = (message as { message?: { content?: unknown[] } }).message
      if (!userMsg?.content || !Array.isArray(userMsg.content)) break

      for (const block of userMsg.content) {
        const b = block as Record<string, unknown>
        if (
          (b.type === "tool_result" || b.type === "mcp_tool_result") &&
          typeof b.tool_use_id === "string"
        ) {
          // MCP tool results wrap content as [{type:"text", text:"..."}]
          // Unwrap and parse the JSON text to get the actual output
          const content = b.content as Array<{ type: string; text?: string }> | undefined
          let output: unknown = content
          if (Array.isArray(content) && content.length === 1 && content[0].type === "text" && content[0].text) {
            try {
              output = JSON.parse(content[0].text)
            } catch {
              output = content[0].text
            }
          }
          events.push(sseToolResult(b.tool_use_id as string, output))
        }
      }
      break
    }

    // Internal SDK messages — skip
    case "system":
    default:
      break
  }

  return events
}

/**
 * Build a clean env for the Claude Code subprocess.
 * The SDK spawns the claude CLI as a child process, which reads
 * ANTHROPIC_API_KEY from its env. We also need to unset CLAUDECODE
 * to avoid the nested-session guard.
 */
function buildSubprocessEnv(provider?: ProviderConfig): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }

  // Unset nested-session guard
  delete env.CLAUDECODE

  // Handle provider-specific configuration
  if (provider) {
    switch (provider.type) {
      case "anthropic-oauth":
        // Use OAuth credentials from ~/.claude/.credentials.json
        delete env.ANTHROPIC_API_KEY
        delete env.ANTHROPIC_BASE_URL
        break

      case "anthropic-key":
        // Direct Anthropic API with user's key
        if (provider.apiKey) {
          env.ANTHROPIC_API_KEY = provider.apiKey
        }
        delete env.ANTHROPIC_BASE_URL
        break

      case "openrouter":
        // OpenRouter proxy
        env.ANTHROPIC_BASE_URL = "https://openrouter.ai/api"
        env.ANTHROPIC_AUTH_TOKEN = provider.apiKey || ""
        env.ANTHROPIC_API_KEY = ""
        break

      case "ollama":
        // Local Ollama instance
        if (provider.baseUrl) {
          env.ANTHROPIC_BASE_URL = provider.baseUrl
        }
        env.ANTHROPIC_API_KEY = "ollama"
        break

      case "custom":
        // Custom endpoint (e.g., LiteLLM, vLLM)
        if (provider.baseUrl) {
          env.ANTHROPIC_BASE_URL = provider.baseUrl
        }
        if (provider.apiKey) {
          env.ANTHROPIC_API_KEY = provider.apiKey
        }
        break
    }

    // Apply model overrides if provided
    if (provider.modelOverrides) {
      if (provider.modelOverrides.sonnet) {
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = provider.modelOverrides.sonnet
      }
      if (provider.modelOverrides.opus) {
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = provider.modelOverrides.opus
      }
      if (provider.modelOverrides.haiku) {
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.modelOverrides.haiku
      }
    }
  } else if (config.anthropicApiKey) {
    // Fallback to server-configured API key
    env.ANTHROPIC_API_KEY = config.anthropicApiKey
    if (config.anthropicBaseUrl) {
      env.ANTHROPIC_BASE_URL = config.anthropicBaseUrl
    }
  } else {
    // No provider or config — use OAuth
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_BASE_URL
  }

  return env
}

/**
 * Create SSE stream from SDK query()
 */
export async function createAgentStream(
  messages: Message[],
  context: StreamContext,
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        const promptGen = createPromptGenerator(messages, context.sessionId)

        const compassMcpServer = createCompassMcpServer(
          config.compassApiBaseUrl,
          context.authToken,
        )

        const subprocessEnv = buildSubprocessEnv(context.provider)

        // Use a unique session ID per query() call. The SDK passes this
        // to the Claude Code CLI subprocess, which uses it for session
        // state/locks. Reusing the same ID across calls causes the
        // subprocess to crash with exit code 1 on subsequent requests.
        // Conversation continuity is handled via system prompt history.
        const querySessionId = crypto.randomUUID()

        const stream = query({
          prompt: promptGen,
          options: {
            systemPrompt: buildSystemPrompt(context, messages),
            model: context.model,
            env: subprocessEnv,
            settingSources: [],
            mcpServers: {
              compass: compassMcpServer,
            },
            allowedTools: ["mcp__compass__*"],
            maxTurns: 25,
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            tools: [],
            includePartialMessages: true,
            sessionId: querySessionId,
          },
        })

        // Track emitted tool IDs to prevent duplicates.
        // The SDK can emit the same tool call as both tool_use and
        // mcp_tool_use in content_block_start events.
        const emittedToolIds = new Set<string>()

        for await (const message of stream) {
          const events = extractSSEEvents(message, emittedToolIds)
          for (const event of events) {
            controller.enqueue(encoder.encode(`data: ${event}\n\n`))
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      } catch (err) {
        console.error("Agent stream error:", err)
        controller.enqueue(encoder.encode(`data: ${sseError(String(err))}\n\n`))
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      }
    },
  })
}
