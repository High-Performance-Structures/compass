"use client"

import * as React from "react"

export type ThreadMessage = {
  readonly id: string
  readonly channelId: string
  readonly threadId: string | null
  readonly content: string
  readonly contentHtml: string | null
  readonly editedAt: string | null
  readonly deletedAt: string | null
  readonly isPinned: boolean
  readonly replyCount: number
  readonly lastReplyAt: string | null
  readonly createdAt: string
  readonly user: {
    readonly id: string
    readonly displayName: string | null
    readonly email: string
    readonly avatarUrl: string | null
  } | null
}

type ConversationsContextType = {
  readonly threadOpen: boolean
  readonly threadMessageId: string | null
  readonly threadParentMessage: ThreadMessage | null
  readonly openThread: (messageId: string, parentMessage: ThreadMessage) => void
  readonly closeThread: () => void
}

const ConversationsContext = React.createContext<ConversationsContextType | undefined>(
  undefined
)

export function useConversations() {
  const context = React.useContext(ConversationsContext)
  if (!context) {
    throw new Error("useConversations must be used within ConversationsProvider")
  }
  return context
}

export function ConversationsProvider({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const [threadOpen, setThreadOpen] = React.useState(false)
  const [threadMessageId, setThreadMessageId] = React.useState<string | null>(null)
  const [threadParentMessage, setThreadParentMessage] = React.useState<ThreadMessage | null>(null)

  const openThread = React.useCallback((messageId: string, parentMessage: ThreadMessage) => {
    setThreadMessageId(messageId)
    setThreadParentMessage(parentMessage)
    setThreadOpen(true)
  }, [])

  const closeThread = React.useCallback(() => {
    setThreadOpen(false)
    setThreadMessageId(null)
    setThreadParentMessage(null)
  }, [])

  const value = React.useMemo(
    () => ({
      threadOpen,
      threadMessageId,
      threadParentMessage,
      openThread,
      closeThread,
    }),
    [threadOpen, threadMessageId, threadParentMessage, openThread, closeThread]
  )

  return (
    <ConversationsContext.Provider value={value}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </ConversationsContext.Provider>
  )
}
