"use client"

import { useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { toast } from "sonner"
import {
  initializeActionHandlers,
  unregisterActionHandler,
  dispatchToolActions,
  ALL_HANDLER_TYPES,
} from "@/lib/agent/chat-adapter"

interface UseCompassChatOptions {
  readonly conversationId?: string | null
  readonly onFinish?: (params: {
    messages: ReadonlyArray<UIMessage>
  }) => void | Promise<void>
  readonly openPanel?: () => void
}

export function useCompassChat(options?: UseCompassChatOptions) {
  const pathname = usePathname()
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const openPanelRef = useRef(options?.openPanel)
  openPanelRef.current = options?.openPanel

  const dispatchedRef = useRef(new Set<string>())

  const chatState = useChat({
    transport: new DefaultChatTransport({
      api: "/api/agent",
      headers: {
        "x-current-page": pathname,
        "x-timezone":
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        "x-conversation-id":
          options?.conversationId ?? "",
      },
    }),
    onFinish: options?.onFinish,
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const isGenerating =
    chatState.status === "streaming" ||
    chatState.status === "submitted"

  // dispatch tool-based client actions on new messages
  useEffect(() => {
    const last = chatState.messages.at(-1)
    if (last?.role !== "assistant") return

    dispatchToolActions(
      last.parts as ReadonlyArray<Record<string, unknown>>,
      dispatchedRef.current
    )
  }, [chatState.messages])

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
    messages: chatState.messages,
    setMessages: chatState.setMessages,
    sendMessage: chatState.sendMessage,
    regenerate: chatState.regenerate,
    stop: chatState.stop,
    status: chatState.status,
    error: chatState.error,
    isGenerating,
    pathname,
  }
}
