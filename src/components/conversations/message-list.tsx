"use client"

import * as React from "react"
import { format, parseISO } from "date-fns"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { MessageItem } from "./message-item"
import { TypingIndicator } from "./typing-indicator"
import { Button } from "@/components/ui/button"
import { getMessages } from "@/app/actions/chat-messages"
import { useRealtimeChannel } from "@/hooks/use-realtime-channel"

type MessageData = {
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
  readonly attachments?: readonly {
    readonly id: string
    readonly fileName: string
    readonly mimeType: string
    readonly fileSize: number
    readonly storageUrl: string
  }[]
  readonly reactions?: readonly {
    readonly emoji: string
    readonly count: number
    readonly reactedByCurrentUser: boolean
  }[]
  readonly user: {
    readonly id: string
    readonly displayName: string | null
    readonly email: string
    readonly avatarUrl: string | null
  } | null
}

type MessageListProps = {
  readonly channelId: string
  readonly initialMessages: readonly MessageData[]
  readonly showThreadActions?: boolean
}

const MAX_MESSAGES = 200

export function MessageList({
  channelId,
  initialMessages,
  showThreadActions = true,
}: MessageListProps) {
  // server returns DESC order; reverse for chronological display
  const [messages, setMessages] = React.useState<readonly MessageData[]>(
    [...initialMessages].reverse()
  )
  const [loading, setLoading] = React.useState(false)
  const [hasMore, setHasMore] = React.useState(true)
  const scrollHeightBeforeLoadRef = React.useRef<number>(0)

  // get last message id for real-time polling
  const lastMessageId = React.useMemo(() => {
    return messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null
  }, [messages])

  // real-time updates
  const { newMessages, typingUsers } = useRealtimeChannel(channelId, lastMessageId)

  // consume new messages from real-time polling
  const consumedNewMessagesRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    if (newMessages.length === 0) return

    // filter out already consumed messages
    const unconsumed = newMessages.filter((msg) => !consumedNewMessagesRef.current.has(msg.id))
    if (unconsumed.length === 0) return

    // mark as consumed
    unconsumed.forEach((msg) => consumedNewMessagesRef.current.add(msg.id))

    // append new messages in chronological order
    setMessages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id))
      const unique = unconsumed.filter((m) => !existingIds.has(m.id))
      // reverse because realtime returns DESC
      return [...prev, ...unique.reverse()]
    })
  }, [newMessages])

  // sync when server re-fetches (router.refresh)
  React.useEffect(() => {
    setMessages([...initialMessages].reverse())
  }, [initialMessages])
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  const loadMoreMessages = React.useCallback(async () => {
    if (loading || !hasMore) return

    setLoading(true)

    // store scroll height before loading
    const scrollEl = scrollRef.current
    if (scrollEl) {
      scrollHeightBeforeLoadRef.current = scrollEl.scrollHeight
    }

    const oldestMessage = messages[0]
    if (!oldestMessage) {
      setLoading(false)
      return
    }

    const result = await getMessages(channelId, {
      limit: 50,
      cursor: oldestMessage.createdAt,
    })

    if (result.success && result.data && result.data.length > 0) {
      // older messages come in DESC; reverse to chronological, prepend
      const older = [...result.data].reverse()
      setMessages((prev) => {
        const combined = [...older, ...prev]
        // limit to MAX_MESSAGES most recent
        return combined.slice(-MAX_MESSAGES)
      })
      if (result.data.length < 50) {
        setHasMore(false)
      }

      // restore scroll position after update
      requestAnimationFrame(() => {
        const newScrollEl = scrollRef.current
        if (newScrollEl && scrollHeightBeforeLoadRef.current > 0) {
          const newScrollHeight = newScrollEl.scrollHeight
          const scrollDiff = newScrollHeight - scrollHeightBeforeLoadRef.current
          newScrollEl.scrollTop += scrollDiff
        }
      })
    } else {
      setHasMore(false)
    }

    setLoading(false)
  }, [channelId, messages, loading, hasMore])

  const groupedMessages = React.useMemo(() => {
    const groups: { date: string; messages: readonly MessageData[] }[] = []
    let currentGroup: MessageData[] = []
    let currentDate = ""

    messages.forEach((msg) => {
      const msgDate = format(parseISO(msg.createdAt), "yyyy-MM-dd")
      if (msgDate !== currentDate) {
        if (currentGroup.length > 0) {
          groups.push({ date: currentDate, messages: currentGroup })
        }
        currentDate = msgDate
        currentGroup = [msg]
      } else {
        currentGroup.push(msg)
      }
    })

    if (currentGroup.length > 0) {
      groups.push({ date: currentDate, messages: currentGroup })
    }

    return groups
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-8 overflow-hidden">
        <p className="text-sm text-muted-foreground">
          No messages yet. Start the conversation!
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full min-h-0 flex-1" ref={scrollRef}>
      <div className="flex flex-col gap-4 p-4">
        {hasMore && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMoreMessages}
              disabled={loading}
            >
              {loading ? "Loading..." : "Load older messages"}
            </Button>
          </div>
        )}

        {groupedMessages.map((group) => (
          <div key={group.date}>
            <div className="sticky top-0 z-10 -mx-4 my-4 bg-background/95 px-4 py-2 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
              <Separator />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs font-medium text-muted-foreground">
                {format(parseISO(group.date), "MMMM d, yyyy")}
              </div>
            </div>
            {group.messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                showThreadAction={showThreadActions}
              />
            ))}
          </div>
        ))}

        {typingUsers.length > 0 && (
          <TypingIndicator users={typingUsers} />
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
