"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chat } from "@/components/ui/chat"
import { cn } from "@/lib/utils"
import {
  useElizaChat,
  initializeActionHandlers,
  executeAction,
  unregisterActionHandler,
  ALL_HANDLER_TYPES,
  type AgentAction,
} from "@/lib/eliza/chat-adapter"
import { DynamicUI } from "./dynamic-ui"
import { useAgentOptional } from "./agent-provider"
import { toast } from "sonner"

interface ChatPanelProps {
  className?: string
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

  const onAction = useCallback((action: AgentAction) => {
    executeAction(action)
  }, [])

  const onError = useCallback((error: Error) => {
    toast.error(error.message)
  }, [])

  useEffect(() => {
    initializeActionHandlers(() => routerRef.current)

    const handleToast = (event: CustomEvent) => {
      const { message, type = "default" } = event.detail ?? {}
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

  const {
    messages,
    isGenerating,
    stop,
    append,
    setMessages,
  } = useElizaChat({
    context: { view: pathname },
    onAction,
    onError,
  })

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
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, setIsOpen, agentContext])

  const suggestions = getSuggestionsForPath(pathname)

  const chatMessages = messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.createdAt,
  }))

  const handleRateResponse = useCallback(
    (
      messageId: string,
      rating: "thumbs-up" | "thumbs-down"
    ) => {
      console.log("Rating:", messageId, rating)
    },
    []
  )

  const [panelWidth, setPanelWidth] = useState(420)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragStartWidth.current) return
      const delta = dragStartX.current - e.clientX
      const next = Math.min(720, Math.max(320, dragStartWidth.current + delta))
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

  // Dashboard has its own inline chat — skip the side panel
  if (pathname === "/dashboard") return null

  return (
    <>
      {/* Panel — mobile: full-screen overlay, desktop: integrated flex child */}
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
          {/* Chat */}
          <div className="flex-1 overflow-hidden">
            <Chat
              messages={chatMessages}
              isGenerating={isGenerating}
              stop={stop}
              append={append}
              suggestions={
                messages.length === 0 ? suggestions : []
              }
              onRateResponse={handleRateResponse}
              setMessages={setMessages as never}
              className="h-full"
            />
          </div>

          {/* Dynamic UI for agent-generated components */}
          {messages.some((m) => m.actions) && (
            <div className="max-h-64 overflow-auto border-t p-4">
              {messages
                .filter((m) => m.actions)
                .slice(-1)
                .map((m) => {
                  const uiAction = m.actions?.find(
                    (a) => a.type === "RENDER_UI"
                  )
                  if (!uiAction?.payload?.spec) return null
                  return (
                    <DynamicUI
                      key={m.id}
                      spec={uiAction.payload.spec as never}
                    />
                  )
                })}
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

      {/* Mobile FAB trigger (desktop uses header button) */}
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
