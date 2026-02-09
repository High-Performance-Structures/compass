// Anthropic API client + agentic tool-calling loop

import Anthropic from "@anthropic-ai/sdk"
import {
  getAnthropicAuth,
  type AnthropicAuth,
  type BridgeConfig,
} from "./config"
import type { RegisterResult } from "./auth"
import {
  executeTool,
  localToolDefinitions,
} from "./tools/registry"
import { buildSystemPrompt } from "./prompt"
import { addMessage, getMessages } from "./session"

type WsSend = (data: string) => void

interface ChatRequest {
  readonly messages: ReadonlyArray<{
    readonly role: string
    readonly parts?: ReadonlyArray<{
      readonly type: string
      readonly text?: string
    }>
  }>
  readonly context: {
    readonly conversationId: string
    readonly currentPage: string
    readonly timezone: string
  }
  readonly model?: string
  readonly runId: string
}

export async function handleChatRequest(
  config: BridgeConfig,
  registration: RegisterResult,
  request: ChatRequest,
  send: WsSend,
  abortSignal: AbortSignal,
): Promise<void> {
  // determine auth mode
  type AuthMode =
    | { kind: "sdk"; client: Anthropic }
    | { kind: "oauth"; token: string }

  let authMode: AuthMode

  const auth = await getAnthropicAuth(config)
  if (!auth) {
    send(
      JSON.stringify({
        type: "chat.error",
        runId: request.runId,
        error:
          "no anthropic API key configured. " +
          "run 'compass-bridge login' to authenticate, " +
          "or set ANTHROPIC_API_KEY env var.",
      }),
    )
    return
  }

  if (auth.type === "apiKey") {
    authMode = {
      kind: "sdk",
      client: new Anthropic({ apiKey: auth.key }),
    }
  } else {
    // oauth -- use raw fetch (SDK doesn't
    // handle custom fetch correctly)
    console.log("[bridge] using OAuth token")
    authMode = { kind: "oauth", token: auth.token }
  }

  const systemPrompt = buildSystemPrompt(registration)
  const conversationId = request.context.conversationId

  // extract text from incoming messages
  for (const msg of request.messages) {
    const text = extractText(msg)
    if (text) {
      addMessage(
        conversationId,
        msg.role === "user" ? "user" : "assistant",
        text,
      )
    }
  }

  const history = getMessages(conversationId)
  const anthropicMessages: Anthropic.MessageParam[] =
    history.map((m) => ({
      role: m.role,
      content: m.content,
    }))

  // build tool definitions
  const compassToolDefs: Anthropic.Tool[] =
    registration.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        properties: {},
      },
    }))

  const localToolDefs: Anthropic.Tool[] =
    localToolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }))

  const allTools = [...compassToolDefs, ...localToolDefs]

  const ALLOWED_MODELS = new Set([
    "claude-sonnet-4-5-20250929",
    "claude-opus-4-6",
    "claude-haiku-4-5-20251001",
  ])
  const modelId =
    request.model && ALLOWED_MODELS.has(request.model)
      ? request.model
      : "claude-sonnet-4-5-20250929"

  const MAX_TOOL_ROUNDS = 15
  let round = 0
  let currentMessages = anthropicMessages

  if (authMode.kind === "sdk") {
    // --- SDK path (apiKey or proxy) ---
    while (
      !abortSignal.aborted &&
      round < MAX_TOOL_ROUNDS
    ) {
      round++
      const stream = authMode.client.messages.stream({
        model: modelId,
        max_tokens: 8192,
        system: systemPrompt,
        messages: currentMessages,
        tools: allTools,
      })

      let fullText = ""
      const toolUses: Array<{
        id: string
        name: string
        input: Record<string, unknown>
      }> = []

      for await (const event of stream) {
        if (abortSignal.aborted) break

        if (event.type === "content_block_delta") {
          const delta = event.delta
          if (
            "type" in delta &&
            delta.type === "text_delta" &&
            "text" in delta
          ) {
            fullText += delta.text
            send(
              JSON.stringify({
                type: "chunk",
                runId: request.runId,
                chunk: {
                  type: "text-delta",
                  textDelta: delta.text,
                },
              }),
            )
          }
        }

        if (event.type === "content_block_start") {
          const block = event.content_block
          if (block.type === "tool_use") {
            send(
              JSON.stringify({
                type: "chunk",
                runId: request.runId,
                chunk: {
                  type: "tool-input-start",
                  toolName: block.name,
                  toolCallId: block.id,
                },
              }),
            )
          }
        }

        if (event.type === "message_stop") {
          break
        }
      }

      const finalMessage = await stream.finalMessage()
      for (const block of finalMessage.content) {
        if (block.type === "tool_use") {
          toolUses.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<
              string,
              unknown
            >,
          })
        }
      }

      if (toolUses.length === 0) {
        if (fullText) {
          addMessage(
            conversationId,
            "assistant",
            fullText,
          )
        }
        break
      }

      // execute tools
      const toolResults: Anthropic.ToolResultBlockParam[] =
        []

      for (const toolUse of toolUses) {
        send(
          JSON.stringify({
            type: "chunk",
            runId: request.runId,
            chunk: {
              type: "tool-input-available",
              toolCallId: toolUse.id,
              input: toolUse.input,
            },
          }),
        )

        const result = await executeTool(
          config,
          toolUse.name,
          toolUse.input,
        )

        send(
          JSON.stringify({
            type: "chunk",
            runId: request.runId,
            chunk: {
              type: "data-part-available",
              id: toolUse.id,
              data: { result },
            },
          }),
        )

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        })
      }

      currentMessages = [
        ...currentMessages,
        {
          role: "assistant" as const,
          content: finalMessage.content,
        },
        {
          role: "user" as const,
          content: toolResults,
        },
      ]
    }
  } else {
    // --- OAuth raw fetch path ---
    // bypass SDK entirely, make direct API calls
    const baseUrl =
      process.env.COMPASS_BRIDGE_ANTHROPIC_BASE_URL ??
      "https://api.anthropic.com"
    const isSetupToken = authMode.token.startsWith(
      "sk-ant-oat",
    )
    if (isSetupToken && baseUrl === "https://api.anthropic.com") {
      send(
        JSON.stringify({
          type: "chat.error",
          runId: request.runId,
          error:
            "Claude Code setup-tokens require Claude Code headers. " +
            "Start the bridge proxy and set COMPASS_BRIDGE_ANTHROPIC_BASE_URL, " +
            "or use an Anthropic API key.",
        }),
      )
      return
    }
    const oauthHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      authorization: `Bearer ${authMode.token}`,
      "anthropic-beta":
        "oauth-2025-04-20," +
        "interleaved-thinking-2025-05-14",
      "user-agent": "compass-bridge/1.0",
    }
    if (baseUrl !== "https://api.anthropic.com") {
      oauthHeaders["x-compass-bridge"] = "true"
    }
    if (process.env.COMPASS_BRIDGE_DEBUG_AUTH === "1") {
      console.log(
        `[bridge] oauth request headers: ${Object.keys(oauthHeaders).join(", ")}`,
      )
      console.log(
        `[bridge] oauth request base: ${baseUrl}`,
      )
      console.log(
        "[bridge] oauth request endpoint: /v1/messages?beta=true",
      )
    }

    while (
      !abortSignal.aborted &&
      round < MAX_TOOL_ROUNDS
    ) {
      round++

      // prefix tool names with mcp_ for oauth endpoint
      const oauthTools = allTools.map((t) => ({
        ...t,
        name: `mcp_${t.name}`,
      }))

      // prefix tool_use names in messages
      const oauthMessages = currentMessages.map((msg) => {
        if (!msg.content || !Array.isArray(msg.content)) {
          return msg
        }
        const content = msg.content.map((block) => {
          if (
            block.type === "tool_use" &&
            !block.name.startsWith("mcp_")
          ) {
            return {
              ...block,
              name: `mcp_${block.name}`,
            }
          }
          return block
        })
        return {
          ...msg,
          content,
        }
      })

      const reqBody = JSON.stringify({
        model: modelId,
        max_tokens: 8192,
        stream: true,
        system: [
          { type: "text", text: systemPrompt },
        ],
        messages: oauthMessages,
        tools: oauthTools,
      })

      const requestUrl = new URL(
        "/v1/messages?beta=true",
        baseUrl,
      )
      const res = await fetch(requestUrl, {
        method: "POST",
        headers: oauthHeaders,
        body: reqBody,
        signal: abortSignal,
      })

      if (!res.ok) {
        const errText = await res.text()
        send(
          JSON.stringify({
            type: "chat.error",
            runId: request.runId,
            error: `anthropic API error (${res.status}): ${errText}`,
          }),
        )
        return
      }

      if (!res.body) {
        send(
          JSON.stringify({
            type: "chat.error",
            runId: request.runId,
            error: "no response body from anthropic",
          }),
        )
        return
      }

      // parse SSE stream
      let fullText = ""
      const toolUses: Array<{
        id: string
        name: string
        input: Record<string, unknown>
      }> = []
       const contentBlocks: Array<
         Record<string, unknown> | undefined
       > = []
      // accumulate partial JSON for tool inputs
      const partialInputs = new Map<number, string>()

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        if (abortSignal.aborted) break
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, {
          stream: true,
        })

        // process complete SSE events
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6).trim()
          if (data === "[DONE]") continue

          let event: Record<string, unknown>
          try {
            event = JSON.parse(data)
          } catch {
            continue
          }

          const eventType = event.type as string

          if (eventType === "content_block_start") {
            const block = event.content_block as Record<
              string,
              unknown
            >
            const index = event.index as number
            // strip mcp_ prefix from tool names
            if (
              block.type === "tool_use" &&
              typeof block.name === "string"
            ) {
              block.name = block.name.replace(
                /^mcp_/,
                "",
              )
              partialInputs.set(index, "")
              send(
                JSON.stringify({
                  type: "chunk",
                  runId: request.runId,
                  chunk: {
                    type: "tool-input-start",
                    toolName: block.name,
                    toolCallId: block.id,
                  },
                }),
              )
            }
            contentBlocks[index] = block
          }

          if (eventType === "content_block_delta") {
            const delta = event.delta as Record<
              string,
              unknown
            >
            const index = event.index as number
            if (delta.type === "text_delta") {
              const text = delta.text as string
              fullText += text
              send(
                JSON.stringify({
                  type: "chunk",
                  runId: request.runId,
                  chunk: {
                    type: "text-delta",
                    textDelta: text,
                  },
                }),
              )
            }
            if (delta.type === "input_json_delta") {
              const partial =
                delta.partial_json as string
              const existing =
                partialInputs.get(index) ?? ""
              partialInputs.set(
                index,
                existing + partial,
              )
            }
          }

          if (eventType === "content_block_stop") {
            const index = event.index as number
            const block = contentBlocks[index]
            if (block?.type === "tool_use") {
              const inputStr =
                partialInputs.get(index) ?? "{}"
              let input: Record<string, unknown> = {}
              try {
                input = JSON.parse(inputStr)
              } catch {
                // malformed input
              }
              toolUses.push({
                id: block.id as string,
                name: block.name as string,
                input,
              })
            }
          }

          if (eventType === "message_stop") {
            break
          }
        }
      }

      // if no tool calls, we're done
      if (toolUses.length === 0) {
        if (fullText) {
          addMessage(
            conversationId,
            "assistant",
            fullText,
          )
        }
        break
      }

      // execute tools
      const toolResultBlocks: Array<
        Anthropic.ToolResultBlockParam
      > = []

      for (const toolUse of toolUses) {
        send(
          JSON.stringify({
            type: "chunk",
            runId: request.runId,
            chunk: {
              type: "tool-input-available",
              toolCallId: toolUse.id,
              input: toolUse.input,
            },
          }),
        )

        const result = await executeTool(
          config,
          toolUse.name,
          toolUse.input,
        )

        send(
          JSON.stringify({
            type: "chunk",
            runId: request.runId,
            chunk: {
              type: "data-part-available",
              id: toolUse.id,
              data: { result },
            },
          }),
        )

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        })
      }

      // build assistant content from blocks
      const assistantContent: Array<
        Anthropic.ContentBlockParam
      > = []
       for (const block of contentBlocks) {
         if (!block) continue
         if (isTextBlock(block)) {
           assistantContent.push({
             type: "text",
             text: fullText,
           })
         } else if (isToolUseBlock(block)) {
           const tu = toolUses.find(
             (t) => t.id === block.id,
           )
           assistantContent.push({
             type: "tool_use",
             id: block.id,
             name: block.name,
             input: tu?.input ?? {},
           })
         }
       }

      currentMessages = [
        ...currentMessages,
        {
          role: "assistant" as const,
          content: assistantContent,
        },
        {
          role: "user" as const,
          content: toolResultBlocks,
        },
      ]
    }
  }

  if (round >= MAX_TOOL_ROUNDS) {
    send(
      JSON.stringify({
        type: "chunk",
        runId: request.runId,
        chunk: {
          type: "text-delta",
          textDelta:
            "\n\n[Reached maximum tool call rounds " +
            `(${MAX_TOOL_ROUNDS}). Stopping.]`,
        },
      }),
    )
  }

  send(
    JSON.stringify({
      type: "chat.done",
      runId: request.runId,
    }),
  )
}

function extractText(msg: {
  readonly role: string
  readonly parts?: ReadonlyArray<{
    readonly type: string
    readonly text?: string
  }>
}): string {
  if (!msg.parts) return ""
  return msg.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text ?? "")
    .join("")
}

function isTextBlock(
  block: Record<string, unknown>,
): block is { type: "text"; text: string } {
  return (
    block.type === "text" &&
    typeof block.text === "string"
  )
}

function isToolUseBlock(
  block: Record<string, unknown>,
): block is {
  type: "tool_use"
  id: string
  name: string
} {
  return (
    block.type === "tool_use" &&
    typeof block.id === "string" &&
    typeof block.name === "string"
  )
}
