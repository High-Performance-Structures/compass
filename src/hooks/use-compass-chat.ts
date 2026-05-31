"use client"

import { useEffect, useMemo, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  initializeActionHandlers,
  unregisterActionHandler,
  dispatchToolActions,
  ALL_HANDLER_TYPES,
} from "@/lib/agent/chat-adapter"
import { useAgent } from "@/hooks/use-agent"
import type { AgentMessage } from "@/lib/agent/message-types"

interface UseCompassChatOptions {
  readonly conversationId?: string | null
  readonly onFinish?: (params: {
    messages: ReadonlyArray<AgentMessage>
  }) => void | Promise<void>
  readonly openPanel?: () => void
  readonly bridgeTransport?: unknown | null // placeholder for future bridge integration
}

export function useCompassChat(options?: UseCompassChatOptions) {
  const pathname = usePathname()
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const openPanelRef = useRef(options?.openPanel)
  openPanelRef.current = options?.openPanel

  const dispatchedRef = useRef(new Set<string>())

  // use the new agent hook
  const agent = useAgent({
    agentServerUrl:
      typeof window !== "undefined" &&
      "compassDesktop" in window
        ? "http://localhost:3001"
        : "",
    sessionId: options?.conversationId ?? undefined,
    currentPage: pathname,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    onFinish: options?.onFinish
      ? (messages) => options.onFinish?.({ messages })
      : undefined,
  })

  const isGenerating =
    agent.status === "streaming"

  // dispatch tool-based client actions on new messages
  useEffect(() => {
    const last = agent.messages.at(-1)
    if (last?.role !== "assistant") return

    // convert AgentPart[] to the format expected by dispatchToolActions
    const toolParts = last.parts
      .filter((p) => p.type === "tool-result")
      .map((p) => {
        const toolResult = p as Extract<
          (typeof last.parts)[number],
          { type: "tool-result" }
        >
        return {
          type: "tool-result",
          toolCallId: toolResult.toolCallId,
          state: "output-available",
          output: toolResult.result,
        }
      })

    dispatchToolActions(
      toolParts as ReadonlyArray<Record<string, unknown>>,
      dispatchedRef.current
    )
  }, [agent.messages])

  // initialize action handlers
  useEffect(() => {
    initializeActionHandlers(
      () => routerRef.current,
      () => openPanelRef.current?.()
    )

    const handleToast = (event: CustomEvent) => {
      const { message, type = "default" } =
        event.detail ?? {}
      if (message) {
        if (type === "success") toast.success(message)
        else if (type === "error") toast.error(message)
        else toast(message)
      }
    }

    window.addEventListener(
      "agent-toast",
      handleToast as EventListener
    )

    return () => {
      window.removeEventListener(
        "agent-toast",
        handleToast as EventListener
      )
      for (const type of ALL_HANDLER_TYPES) {
        unregisterActionHandler(type)
      }
    }
  }, [])

  return {
    messages: agent.messages,
    setMessages: agent.setMessages,
    sendMessage: agent.sendMessage,
    regenerate: agent.regenerate,
    stop: agent.stop,
    status: agent.status,
    error: agent.error,
    isGenerating,
    pathname,
  }
}
