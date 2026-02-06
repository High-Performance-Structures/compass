"use client"

import * as React from "react"
import { type UIMessage } from "ai"
import {
  saveConversation,
  loadConversation,
  loadConversations,
} from "@/app/actions/agent"
import { getTextFromParts } from "@/lib/agent/chat-adapter"
import { useCompassChat } from "@/hooks/use-compass-chat"

// --- Panel context (open/close sidebar) ---

interface PanelContextValue {
  readonly isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const PanelContext =
  React.createContext<PanelContextValue | null>(null)

export function useChatPanel(): PanelContextValue {
  const ctx = React.useContext(PanelContext)
  if (!ctx) {
    throw new Error(
      "useChatPanel must be used within a ChatProvider"
    )
  }
  return ctx
}

// --- Chat state context ---

interface ChatStateValue {
  readonly messages: ReadonlyArray<UIMessage>
  setMessages: (
    messages:
      | UIMessage[]
      | ((prev: UIMessage[]) => UIMessage[])
  ) => void
  sendMessage: (params: { text: string }) => void
  regenerate: () => void
  stop: () => void
  readonly status: string
  readonly isGenerating: boolean
  readonly conversationId: string | null
  newChat: () => void
  readonly pathname: string
}

const ChatStateContext =
  React.createContext<ChatStateValue | null>(null)

export function useChatState(): ChatStateValue {
  const ctx = React.useContext(ChatStateContext)
  if (!ctx) {
    throw new Error(
      "useChatState must be used within a ChatProvider"
    )
  }
  return ctx
}

// --- Backward compat aliases ---

export function useAgent(): PanelContextValue {
  return useChatPanel()
}

export function useAgentOptional(): PanelContextValue | null {
  return React.useContext(PanelContext)
}

// --- Provider component ---

export function ChatProvider({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [conversationId, setConversationId] =
    React.useState<string | null>(null)
  const [resumeLoaded, setResumeLoaded] =
    React.useState(false)

  const chat = useCompassChat({
    onFinish: async ({ messages: finalMessages }) => {
      if (finalMessages.length === 0) return

      const id = conversationId ?? crypto.randomUUID()
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
  })

  // resume last conversation on first open
  React.useEffect(() => {
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
      chat.setMessages(restored)
      setResumeLoaded(true)
    }

    resume()
  }, [isOpen, resumeLoaded, chat.setMessages])

  const newChat = React.useCallback(() => {
    chat.setMessages([])
    setConversationId(null)
    setResumeLoaded(true)
  }, [chat.setMessages])

  const panelValue = React.useMemo(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((prev) => !prev),
    }),
    [isOpen]
  )

  const chatValue = React.useMemo(
    () => ({
      messages: chat.messages,
      setMessages: chat.setMessages,
      sendMessage: chat.sendMessage,
      regenerate: chat.regenerate,
      stop: chat.stop,
      status: chat.status,
      isGenerating: chat.isGenerating,
      conversationId,
      newChat,
      pathname: chat.pathname,
    }),
    [
      chat.messages,
      chat.setMessages,
      chat.sendMessage,
      chat.regenerate,
      chat.stop,
      chat.status,
      chat.isGenerating,
      conversationId,
      newChat,
      chat.pathname,
    ]
  )

  return (
    <PanelContext.Provider value={panelValue}>
      <ChatStateContext.Provider value={chatValue}>
        {children}
      </ChatStateContext.Provider>
    </PanelContext.Provider>
  )
}
