"use client"

import { useState, useRef, useCallback } from "react"
import type { AgentMessage, SSEEvent } from "@/lib/agent/message-types"
import { dispatchToolActions } from "@/lib/agent/chat-adapter"
import { getAgentModelId } from "@/components/agent/model-dropdown"

export interface UseAgentOptions {
  readonly agentServerUrl?: string
  readonly sessionId?: string
  readonly currentPage?: string
  readonly timezone?: string
  readonly onFinish?: (messages: ReadonlyArray<AgentMessage>) => void | Promise<void>
}

export interface UseAgentReturn {
  readonly messages: ReadonlyArray<AgentMessage>
  setMessages: (
    msgs: AgentMessage[] | ((prev: AgentMessage[]) => AgentMessage[])
  ) => void
  sendMessage: (params: { text: string }) => Promise<boolean>
  stop: () => void
  regenerate: () => void
  readonly status: "ready" | "streaming" | "error"
  readonly error: string | null
}

/**
 * Core SSE consumer hook for the agent server
 * Handles streaming, parsing, and message accumulation
 */
export function useAgent(options: UseAgentOptions = {}): UseAgentReturn {
  const {
    agentServerUrl = "",
    sessionId = crypto.randomUUID(),
    currentPage = "/dashboard",
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    onFinish,
  } = options

  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [status, setStatus] = useState<"ready" | "streaming" | "error">("ready")
  const [error, setError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const dispatchedRef = useRef(new Set<string>())

  const sendMessage = useCallback(
    async (params: { text: string }): Promise<boolean> => {
      if (status === "streaming") return false
      if (!params.text.trim()) return false

      // add user message
      const userMessage: AgentMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: params.text }],
        createdAt: new Date(),
      }

      setMessages((prev) => [...prev, userMessage])
      setStatus("streaming")
      setError(null)

      // create assistant message stub
      const assistantId = crypto.randomUUID()
      const assistantMessage: AgentMessage = {
        id: assistantId,
        role: "assistant",
        parts: [],
        createdAt: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])

      // prepare request
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        // Determine endpoint based on mode
        const isStandalone = agentServerUrl !== ""
        const endpoint = isStandalone
          ? `${agentServerUrl}/agent/chat`
          : `/api/agent`

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "x-session-id": sessionId,
          "x-current-page": currentPage,
          "x-timezone": timezone,
        }

        // Standalone mode: JWT auth via server action
        // Cloud mode: WorkOS session cookie (same-origin, automatic)
        if (isStandalone) {
          headers["x-model"] = getAgentModelId()
          const { getAgentToken } = await import("@/app/actions/agent-auth")
          const tokenResult = await getAgentToken()
          if ("error" in tokenResult) {
            throw new Error(tokenResult.error)
          }
          headers["Authorization"] = `Bearer ${tokenResult.token}`
        }

        const allMessages = [...messages, userMessage]

        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            messages: allMessages.map((m) => ({
              role: m.role,
              content: m.parts
                .filter((p) => p.type === "text")
                .map((p) => (p as { text: string }).text)
                .join(""),
            })),
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const payload = await response
            .json()
            .catch(() => null)
          const message =
            payload &&
            typeof payload === "object" &&
            "error" in payload &&
            typeof payload.error === "string"
              ? payload.error
              : `Agent server error: ${response.status}`
          throw new Error(message)
        }

        if (!response.body) {
          throw new Error("No response body")
        }

        // parse SSE stream
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        // accumulate parts for current assistant message
        const parts: Array<
          AgentMessage["parts"][number]
        > = []

        // track active tool calls for state updates
        const toolCallMap = new Map<
          string,
          { name: string; args: unknown; state: "partial-call" | "call" | "result" }
        >()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // split on SSE boundaries
          const lines = buffer.split("\n\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue

            const data = line.slice(6).trim()
            if (data === "[DONE]") {
              // stream complete
              setStatus("ready")

              const finalMessages = [
                ...messages,
                userMessage,
                { ...assistantMessage, parts },
              ]
              setMessages(finalMessages)

              if (onFinish) {
                try {
                  await onFinish(finalMessages)
                } catch (finishError) {
                  console.error(
                    "Agent response completed but conversation persistence failed:",
                    finishError,
                  )
                }
              }
              return true
            }

            try {
              const event = JSON.parse(data) as SSEEvent

              switch (event.type) {
                case "text": {
                  // streaming text delta — append to last text part or create new
                  const lastPart = parts[parts.length - 1]
                  if (lastPart?.type === "text") {
                    parts[parts.length - 1] = {
                      type: "text",
                      text: lastPart.text + event.content,
                    }
                  } else {
                    parts.push({ type: "text", text: event.content })
                  }
                  break
                }

                case "tool_use": {
                  // create tool-call part
                  toolCallMap.set(event.toolCallId, {
                    name: event.name,
                    args: event.input,
                    state: "call",
                  })
                  parts.push({
                    type: "tool-call",
                    toolName: event.name,
                    toolCallId: event.toolCallId,
                    args: event.input,
                    state: "call",
                  })
                  break
                }

                case "tool_result": {
                  // update tool-call state to "result"
                  const toolCall = toolCallMap.get(event.toolCallId)
                  if (toolCall) {
                    toolCall.state = "result"

                    // find and update the tool-call part
                    const idx = parts.findIndex(
                      (p) =>
                        p.type === "tool-call" &&
                        p.toolCallId === event.toolCallId
                    )
                    if (idx !== -1) {
                      const existingPart = parts[idx]
                      if (existingPart.type === "tool-call") {
                        parts[idx] = { ...existingPart, state: "result" }
                      }
                    }
                  }

                  // add tool-result part
                  parts.push({
                    type: "tool-result",
                    toolCallId: event.toolCallId,
                    result: event.output,
                    isError: false,
                  })

                  // check for action dispatch
                  const output = event.output as Record<string, unknown> | null
                  if (output?.action && !dispatchedRef.current.has(event.toolCallId)) {
                    dispatchedRef.current.add(event.toolCallId)
                    // dispatch as if it were a tool part with output
                    dispatchToolActions(
                      [
                        {
                          type: "tool-result",
                          toolCallId: event.toolCallId,
                          state: "output-available",
                          output: event.output,
                        },
                      ],
                      dispatchedRef.current
                    )
                  }
                  break
                }

                case "tool_progress": {
                  // optional progress event — could be used for loading states
                  // for now, just log it (or could update tool-call state)
                  console.log(
                    `[agent] tool progress: ${event.toolName} (${event.elapsedSeconds}s)`
                  )
                  break
                }

                case "result": {
                  // Result text is the full response — already streamed
                  // via text deltas, so don't append it again.
                  if (event.usage) {
                    console.log("[agent] usage:", {
                      input: event.usage.inputTokens,
                      output: event.usage.outputTokens,
                      cost: `$${event.usage.totalCostUsd.toFixed(4)}`,
                    })
                  }
                  break
                }

                case "error": {
                  setError(event.error)
                  setStatus("error")
                  return false
                }
              }

              // update UI with accumulated parts
              setMessages((prev) => {
                const updated = [...prev]
                const lastIdx = updated.length - 1
                if (
                  lastIdx >= 0 &&
                  updated[lastIdx].role === "assistant"
                ) {
                  updated[lastIdx] = {
                    ...updated[lastIdx],
                    parts: [...parts],
                  }
                }
                return updated
              })
            } catch (parseErr) {
              console.error("Failed to parse SSE event:", parseErr)
            }
          }
        }

        // if we exit the loop without [DONE], treat as complete
        setStatus("ready")
        const finalMessages = [
          ...messages,
          userMessage,
          { ...assistantMessage, parts },
        ]
        setMessages(finalMessages)

        if (onFinish) {
          try {
            await onFinish(finalMessages)
          } catch (finishError) {
            console.error(
              "Agent response completed but conversation persistence failed:",
              finishError,
            )
          }
        }
        return true
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          setStatus("ready")
        } else {
          const errMsg =
            err instanceof Error ? err.message : "Unknown error"
          setError(errMsg)
          setStatus("error")
        }
        return false
      } finally {
        abortControllerRef.current = null
      }
    },
    [
      messages,
      status,
      agentServerUrl,
      sessionId,
      currentPage,
      timezone,
      onFinish,
    ]
  )

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  const regenerate = useCallback(() => {
    // remove last assistant message and resend
    setMessages((prev) => {
      const filtered = prev.filter(
        (m, i) => i !== prev.length - 1 || m.role !== "assistant"
      )
      const lastUser = [...filtered].reverse().find((m) => m.role === "user")
      if (lastUser) {
        // extract text from last user message
        const text = lastUser.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { text: string }).text)
          .join("")

        // re-send (but keep the filtered messages first)
        setTimeout(() => sendMessage({ text }), 0)
        return filtered
      }
      return filtered
    })
  }, [sendMessage])

  return {
    messages,
    setMessages,
    sendMessage,
    stop,
    regenerate,
    status,
    error,
  }
}
