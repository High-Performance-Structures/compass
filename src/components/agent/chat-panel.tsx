"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chat } from "@/components/ui/chat"
import { cn } from "@/lib/utils"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import {
  initializeActionHandlers,
  unregisterActionHandler,
  dispatchToolActions,
  ALL_HANDLER_TYPES,
} from "@/lib/agent/chat-adapter"
import {
  saveConversation,
  loadConversation,
  loadConversations,
} from "@/app/actions/agent"
import { DynamicUI } from "./dynamic-ui"
import { useAgentOptional } from "./agent-provider"
import { toast } from "sonner"
import type { ComponentSpec } from "@/lib/agent/catalog"

interface ChatPanelProps {
  className?: string
}

function getTextFromParts(
  parts: ReadonlyArray<{ type: string; text?: string }>
): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text"
    )
    .map((p) => p.text)
    .join("")
}

export function ChatPanel({ className }: ChatPanelProps) {
  const agentContext = useAgentOptional()
  const isOpen = agentContext?.isOpen ?? false
  const setIsOpen = agentContext
    ? (open: boolean) =>
        open ? agentContext.open() : agentContext.close()
    : () => {}

  const router = useRouter()
  const pathname = usePathname()

  const routerRef = useRef(router)
  routerRef.current = router

  const [conversationId, setConversationId] = useState<
    string | null
  >(null)
  const [resumeLoaded, setResumeLoaded] = useState(false)

  const {
    messages,
    setMessages,
    sendMessage,
    stop,
    status,
    error,
  } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/agent",
      headers: { "x-current-page": pathname },
    }),
    onFinish: async ({ messages: finalMessages }) => {
      if (finalMessages.length === 0) return

      const id =
        conversationId ?? crypto.randomUUID()
      if (!conversationId) setConversationId(id)

      const serialized = finalMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: getTextFromParts(
          m.parts as ReadonlyArray<{
            type: string
            text?: string
          }>
        ),
        parts: m.parts,
        createdAt: new Date().toISOString(),
      }))

      await saveConversation(id, serialized)
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  // dispatch tool-based client actions when messages update
  useEffect(() => {
    const last = messages.at(-1)
    if (last?.role !== "assistant") return

    const parts = last.parts as ReadonlyArray<{
      type: string
      toolInvocation?: {
        toolName: string
        state: string
        result?: unknown
      }
    }>

    dispatchToolActions(parts)
  }, [messages])

  // initialize action handlers
  useEffect(() => {
    initializeActionHandlers(() => routerRef.current)

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

  // resume last conversation when panel opens
  useEffect(() => {
    if (!isOpen || resumeLoaded) return

    const resume = async () => {
      const result = await loadConversations()
      if (
        !result.success ||
        !result.data ||
        result.data.length === 0
      ) {
        setResumeLoaded(true)
        return
      }

      const lastConv = result.data[0]
      const msgResult = await loadConversation(lastConv.id)
      if (
        !msgResult.success ||
        !msgResult.data ||
        msgResult.data.length === 0
      ) {
        setResumeLoaded(true)
        return
      }

      setConversationId(lastConv.id)

      const restored: UIMessage[] = msgResult.data.map(
        (m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          parts:
            (m.parts as UIMessage["parts"]) ?? [
              { type: "text" as const, text: m.content },
            ],
        })
      )
      setMessages(restored)
      setResumeLoaded(true)
    }

    resume()
  }, [isOpen, resumeLoaded, setMessages])

  // keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault()
        agentContext?.toggle()
      }
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () =>
      window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, setIsOpen, agentContext])

  const suggestions = getSuggestionsForPath(pathname)

  const isGenerating =
    status === "streaming" || status === "submitted"

  // map UIMessage to the legacy Message format for Chat
  const chatMessages = messages.map((msg) => {
    const parts = msg.parts as ReadonlyArray<{
      type: string
      text?: string
    }>
    return {
      id: msg.id,
      role: msg.role as "user" | "assistant",
      content: getTextFromParts(parts),
      parts: msg.parts as Array<{
        type: "text"
        text: string
      }>,
    }
  })

  const handleAppend = useCallback(
    (message: { role: "user"; content: string }) => {
      sendMessage({ text: message.content })
    },
    [sendMessage]
  )

  const handleNewChat = useCallback(() => {
    setMessages([])
    setConversationId(null)
    setResumeLoaded(true)
  }, [setMessages])

  const handleRateResponse = useCallback(
    (
      messageId: string,
      rating: "thumbs-up" | "thumbs-down"
    ) => {
      console.log("Rating:", messageId, rating)
    },
    []
  )

  // resize state
  const [panelWidth, setPanelWidth] = useState(420)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragStartWidth.current) return
      const delta = dragStartX.current - e.clientX
      const next = Math.min(
        720,
        Math.max(320, dragStartWidth.current + delta)
      )
      setPanelWidth(next)
    }
    const onMouseUp = () => {
      if (!dragStartWidth.current) return
      dragStartWidth.current = 0
      setIsResizing(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
      dragStartX.current = e.clientX
      dragStartWidth.current = panelWidth
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    },
    [panelWidth]
  )

  // extract last render component spec from tool results
  const lastRenderSpec = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== "assistant") continue
      for (const part of msg.parts) {
        const p = part as {
          type: string
          toolInvocation?: {
            toolName: string
            state: string
            result?: {
              action?: string
              spec?: unknown
            }
          }
        }
        if (
          p.type?.startsWith("tool-") &&
          p.toolInvocation?.state === "result" &&
          p.toolInvocation?.result?.action === "render"
        ) {
          return p.toolInvocation.result.spec as
            | ComponentSpec
            | undefined
        }
      }
    }
    return undefined
  })()

  // Dashboard has its own inline chat
  if (pathname === "/dashboard") return null

  return (
    <>
      <div
        className={cn(
          "flex flex-col bg-background",
          "fixed inset-0 z-50",
          "md:relative md:inset-auto md:z-auto",
          "md:shrink-0 md:overflow-hidden md:border-l md:border-border",
          isResizing
            ? "transition-none"
            : "transition-[transform,width,border-color] duration-300 ease-in-out",
          isOpen
            ? "translate-x-0"
            : "translate-x-full md:translate-x-0 md:w-0 md:border-l-0",
          className
        )}
        style={isOpen ? { width: panelWidth } : undefined}
      >
        {/* Desktop resize handle */}
        <div
          className="absolute left-0 top-0 z-10 hidden h-full w-1 cursor-col-resize md:block hover:bg-border/60 active:bg-border"
          onMouseDown={handleResizeStart}
        />

        <div className="flex h-full w-full flex-col">
          {/* Header with new chat button */}
          {messages.length > 0 && (
            <div className="flex items-center justify-end border-b px-3 py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNewChat}
              >
                New chat
              </Button>
            </div>
          )}

          {/* Chat */}
          <div className="flex-1 overflow-hidden">
            <Chat
              messages={chatMessages}
              isGenerating={isGenerating}
              stop={stop}
              append={handleAppend}
              suggestions={
                messages.length === 0 ? suggestions : []
              }
              onRateResponse={handleRateResponse}
              setMessages={
                setMessages as unknown as (
                  messages: Array<{
                    id: string
                    role: string
                    content: string
                  }>
                ) => void
              }
              className="h-full"
            />
          </div>

          {/* Dynamic UI for agent-rendered components */}
          {lastRenderSpec && (
            <div className="max-h-64 overflow-auto border-t p-4">
              <DynamicUI spec={lastRenderSpec} />
            </div>
          )}
        </div>
      </div>

      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile FAB trigger */}
      {!isOpen && (
        <Button
          size="icon"
          className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg md:hidden"
          onClick={() => setIsOpen(true)}
          aria-label="Open chat"
        >
          <MessageSquare className="h-5 w-5" />
        </Button>
      )}
    </>
  )
}

function getSuggestionsForPath(pathname: string): string[] {
  if (pathname.includes("/customers")) {
    return [
      "Show me all customers",
      "Create a new customer",
      "Find customers without email",
    ]
  }
  if (pathname.includes("/vendors")) {
    return [
      "List all vendors",
      "Add a new subcontractor",
      "Show vendors by category",
    ]
  }
  if (pathname.includes("/schedule")) {
    return [
      "What tasks are on the critical path?",
      "Show overdue tasks",
      "Add a new task",
    ]
  }
  if (pathname.includes("/finances")) {
    return [
      "Show overdue invoices",
      "What payments are pending?",
      "Create a new invoice",
    ]
  }
  if (pathname.includes("/projects")) {
    return [
      "List all active projects",
      "Create a new project",
      "Which projects are behind schedule?",
    ]
  }
  if (pathname.includes("/netsuite")) {
    return [
      "Sync customers from NetSuite",
      "Check for sync conflicts",
      "When was the last sync?",
    ]
  }

  return [
    "What can you help me with?",
    "Show me today's tasks",
    "Navigate to customers",
  ]
}

export default ChatPanel
