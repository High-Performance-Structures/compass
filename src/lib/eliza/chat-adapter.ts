/**
 * ElizaOS Chat Adapter
 *
 * useChat-like hook for the shadcn Chat component.
 * Communicates with ElizaOS via the /api/agent proxy route.
 *
 * Bug fixes from original:
 * 1. initializeActionHandlers accepts getter fn (not stale router ref)
 * 2. context option passed in POST body
 * 3. useEffect cleanup for handler unregistration
 * 4. options stored in ref to avoid stale closures in sendMessage
 */

"use client"

import { useState, useCallback, useRef } from "react"

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt?: Date
  actions?: ReadonlyArray<AgentAction>
  isLoading?: boolean
}

export interface AgentAction {
  type: string
  payload?: Record<string, unknown>
}

export interface UseElizaChatOptions {
  conversationId?: string
  context?: { view?: string; projectId?: string }
  onConversationCreate?: (id: string) => void
  onAction?: (action: AgentAction) => void
  onError?: (error: Error) => void
}

export interface UseElizaChatReturn {
  messages: ReadonlyArray<ChatMessage>
  input: string
  setInput: (value: string) => void
  handleInputChange: (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => void
  handleSubmit: (e?: React.FormEvent) => Promise<void>
  isGenerating: boolean
  stop: () => void
  append: (message: { role: "user"; content: string }) => Promise<void>
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  conversationId: string | null
  reload: () => Promise<void>
}

interface AgentResponse {
  id: string
  text: string
  actions?: ReadonlyArray<AgentAction>
  conversationId: string
}

export function useElizaChat(
  options: UseElizaChatOptions = {}
): UseElizaChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(
    options.conversationId ?? null
  )
  const abortControllerRef = useRef<AbortController | null>(null)

  // Fix bug 4: store options in ref so sendMessage doesn't
  // close over a stale options object
  const optionsRef = useRef(options)
  optionsRef.current = options

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value)
    },
    []
  )

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        createdAt: new Date(),
      }
      setMessages((prev) => [...prev, userMessage])

      const loadingMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        isLoading: true,
        createdAt: new Date(),
      }
      setMessages((prev) => [...prev, loadingMessage])

      setIsGenerating(true)
      abortControllerRef.current = new AbortController()

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content,
            conversationId,
            // Fix bug 2: include context in POST body
            context: optionsRef.current.context,
          }),
          signal: abortControllerRef.current.signal,
        })

        if (!response.ok) {
          const errorData = (await response.json()) as {
            error?: string
          }
          throw new Error(errorData.error ?? "Failed to get response")
        }

        const data: AgentResponse = await response.json()

        if (
          data.conversationId &&
          data.conversationId !== conversationId
        ) {
          setConversationId(data.conversationId)
          optionsRef.current.onConversationCreate?.(
            data.conversationId
          )
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === loadingMessage.id
              ? {
                  ...msg,
                  id: data.id,
                  content: data.text,
                  actions: data.actions
                    ? [...data.actions]
                    : undefined,
                  isLoading: false,
                }
              : msg
          )
        )

        if (data.actions) {
          for (const action of data.actions) {
            optionsRef.current.onAction?.(action)
          }
        }
      } catch (err) {
        const error = err as Error
        if (error.name === "AbortError") {
          setMessages((prev) =>
            prev.filter((msg) => msg.id !== loadingMessage.id)
          )
        } else {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === loadingMessage.id
                ? {
                    ...msg,
                    content:
                      "Sorry, I encountered an error. Please try again.",
                    isLoading: false,
                  }
                : msg
            )
          )
          optionsRef.current.onError?.(error)
        }
      } finally {
        setIsGenerating(false)
        abortControllerRef.current = null
      }
    },
    // Fix bug 4: only depend on conversationId, not options
    [conversationId]
  )

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault()
      const content = input.trim()
      setInput("")
      await sendMessage(content)
    },
    [input, sendMessage]
  )

  const stop = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsGenerating(false)
  }, [])

  const append = useCallback(
    async (message: { role: "user"; content: string }) => {
      await sendMessage(message.content)
    },
    [sendMessage]
  )

  const reload = useCallback(async () => {
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === "user")
    if (lastUserMessage) {
      setMessages((prev) => {
        const lastIndex = prev.findLastIndex(
          (m) => m.role === "assistant"
        )
        if (lastIndex >= 0) {
          return prev.filter((_, i) => i !== lastIndex)
        }
        return prev
      })
      await sendMessage(lastUserMessage.content)
    }
  }, [messages, sendMessage])

  return {
    messages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    isGenerating,
    stop,
    append,
    setMessages,
    conversationId,
    reload,
  }
}

// --- Action handler registry ---

export type ActionHandler = (
  payload?: Record<string, unknown>
) => void | Promise<void>

const actionHandlers = new Map<string, ActionHandler>()

export function registerActionHandler(
  type: string,
  handler: ActionHandler
): void {
  actionHandlers.set(type, handler)
}

export function unregisterActionHandler(type: string): void {
  actionHandlers.delete(type)
}

export async function executeAction(
  action: AgentAction
): Promise<void> {
  const handler = actionHandlers.get(action.type)
  if (handler) {
    await handler(action.payload)
  } else {
    console.warn(
      `No handler registered for action type: ${action.type}`
    )
  }
}

// Fix bug 1: accept getter function instead of direct router ref
// so the handler always uses the current router instance
export function initializeActionHandlers(
  getRouter: () => { push: (path: string) => void }
): void {
  registerActionHandler("NAVIGATE_TO", (payload) => {
    if (payload?.path && typeof payload.path === "string") {
      getRouter().push(payload.path)
    }
  })

  registerActionHandler("SHOW_TOAST", (payload) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-toast", { detail: payload })
      )
    }
  })

  registerActionHandler("OPEN_MODAL", (payload) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-modal", { detail: payload })
      )
    }
  })

  registerActionHandler("CLOSE_MODAL", () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("agent-modal-close"))
    }
  })

  registerActionHandler("SCROLL_TO", (payload) => {
    if (payload?.target && typeof payload.target === "string") {
      const el = document.querySelector(
        `[data-section="${payload.target}"], #${payload.target}`
      )
      el?.scrollIntoView({ behavior: "smooth" })
    }
  })

  registerActionHandler("FOCUS_ELEMENT", (payload) => {
    if (payload?.selector && typeof payload.selector === "string") {
      const el = document.querySelector(
        payload.selector
      ) as HTMLElement | null
      el?.focus()
    }
  })
}

// All registered handler types for cleanup
export const ALL_HANDLER_TYPES = [
  "NAVIGATE_TO",
  "SHOW_TOAST",
  "OPEN_MODAL",
  "CLOSE_MODAL",
  "SCROLL_TO",
  "FOCUS_ELEMENT",
] as const
