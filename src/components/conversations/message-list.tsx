"use client"

import * as React from "react"
import { format, parseISO } from "date-fns"
import { ArrowDown } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { MessageItem } from "./message-item"
import { TypingIndicator } from "./typing-indicator"
import { Button } from "@/components/ui/button"
import { getMessages } from "@/app/actions/chat-messages"
import { useRealtimeChannel } from "@/hooks/use-realtime-channel"
import {
  getNewestScrollTop,
  getPreservedScrollTop,
  getHistoryLoadError,
  isHistoryRequestCurrent,
  isHistoryScrollRestoreCurrent,
  isAtNewestEdge,
  mergeOlderMessagePage,
} from "./message-list-behavior"

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
  readonly currentUserId: string | null
}

type MessageWindowState = {
  readonly messages: readonly MessageData[]
  readonly hasMore: boolean
}

const MAX_MESSAGES = 200
const HISTORY_PAGE_SIZE = 50

export function MessageList({
  channelId,
  initialMessages,
  showThreadActions = true,
  currentUserId,
}: MessageListProps) {
  // server returns DESC order; reverse for chronological display
  const [messageWindow, setMessageWindow] = React.useState<MessageWindowState>({
    messages: [...initialMessages].reverse(),
    hasMore: true,
  })
  const { messages, hasMore } = messageWindow
  const [loading, setLoading] = React.useState(false)
  const [historyError, setHistoryError] = React.useState<string | null>(null)
  const [atNewestEdge, setAtNewestEdge] = React.useState(true)
  const [historyCommitId, setHistoryCommitId] = React.useState(0)
  const [realtimeCommitId, setRealtimeCommitId] = React.useState(0)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const prependScrollRef = React.useRef<{
    readonly requestId: number
    readonly scrollTop: number
    readonly scrollHeight: number
    readonly wasAtNewestEdge: boolean
    readonly scrollIntentId: number
  } | null>(null)
  const pendingNewestScrollRef = React.useRef(false)
  const historyRequestIdRef = React.useRef(0)
  const scrollIntentIdRef = React.useRef(0)

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
    pendingNewestScrollRef.current = atNewestEdge

    // append new messages in chronological order
    setMessageWindow((previous) => {
      const existingIds = new Set(previous.messages.map((message) => message.id))
      const unique = unconsumed.filter((m) => !existingIds.has(m.id))
      // reverse because realtime returns DESC
      return {
        ...previous,
        messages: [...previous.messages, ...unique.reverse()].slice(-MAX_MESSAGES),
      }
    })
    setRealtimeCommitId((previous) => previous + 1)
  }, [atNewestEdge, newMessages])

  const getScrollViewport = React.useCallback((): HTMLElement | null => {
    return scrollRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    ) ?? null
  }, [])

  const scrollToNewest = React.useCallback(
    (behavior: ScrollBehavior): void => {
      historyRequestIdRef.current += 1
      prependScrollRef.current = null
      setLoading(false)
      setHistoryError(null)
      const viewport = getScrollViewport()
      if (viewport) {
        viewport.scrollTo({
          top: getNewestScrollTop(viewport),
          behavior,
        })
      }
      setAtNewestEdge(true)
    },
    [getScrollViewport],
  )

  // sync when server re-fetches (router.refresh)
  React.useEffect(() => {
    historyRequestIdRef.current += 1
    prependScrollRef.current = null
    pendingNewestScrollRef.current = false
    setLoading(false)
    setHistoryError(null)
    setAtNewestEdge(true)
    setMessageWindow({
      messages: [...initialMessages].reverse(),
      hasMore: true,
    })
    const frame = requestAnimationFrame(() => scrollToNewest("auto"))
    return () => cancelAnimationFrame(frame)
  }, [initialMessages, scrollToNewest])

  React.useLayoutEffect(() => {
    const viewport = getScrollViewport()
    if (!viewport) return

    if (pendingNewestScrollRef.current) {
      pendingNewestScrollRef.current = false
      viewport.scrollTop = getNewestScrollTop(viewport)
      setAtNewestEdge(true)
    }
  }, [getScrollViewport, realtimeCommitId])

  React.useLayoutEffect(() => {
    const viewport = getScrollViewport()
    const prependScroll = prependScrollRef.current
    if (!viewport || prependScroll?.requestId !== historyCommitId) return

    if (
      !isHistoryScrollRestoreCurrent(
        prependScroll.requestId,
        historyRequestIdRef.current,
        prependScroll.scrollIntentId,
        scrollIntentIdRef.current,
      )
    ) {
      prependScrollRef.current = null
      pendingNewestScrollRef.current = false
      setAtNewestEdge(isAtNewestEdge(viewport))
      return
    }

    if (prependScroll.wasAtNewestEdge) {
      viewport.scrollTop = getNewestScrollTop(viewport)
    } else {
      viewport.scrollTop = getPreservedScrollTop({
        scrollTop: prependScroll.scrollTop,
        previousScrollHeight: prependScroll.scrollHeight,
        nextScrollHeight: viewport.scrollHeight,
      })
    }
    prependScrollRef.current = null
    pendingNewestScrollRef.current = false
    setAtNewestEdge(isAtNewestEdge(viewport))
  }, [getScrollViewport, historyCommitId])

  React.useEffect(() => {
    const viewport = getScrollViewport()
    if (!viewport) return

    const updateNewestEdge = () => {
      scrollIntentIdRef.current += 1
      setAtNewestEdge(isAtNewestEdge(viewport))
    }
    viewport.addEventListener("scroll", updateNewestEdge)
    updateNewestEdge()
    return () => viewport.removeEventListener("scroll", updateNewestEdge)
  }, [getScrollViewport])

  const loadMoreMessages = React.useCallback(async () => {
    if (loading || !hasMore) return

    const oldestMessage = messages[0]
    if (!oldestMessage) return

    const requestId = historyRequestIdRef.current + 1
    historyRequestIdRef.current = requestId
    const viewport = getScrollViewport()
    if (viewport) {
      prependScrollRef.current = {
        requestId,
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        wasAtNewestEdge: isAtNewestEdge(viewport),
        scrollIntentId: scrollIntentIdRef.current,
      }
    }
    setHistoryError(null)
    setLoading(true)

    try {
      const result = await getMessages(channelId, {
        limit: HISTORY_PAGE_SIZE,
        cursor: oldestMessage.createdAt,
      })

      if (!isHistoryRequestCurrent(requestId, historyRequestIdRef.current)) {
        return
      }

      if (result.success && result.data && result.data.length > 0) {
        // older messages come in DESC; reverse to chronological, prepend
        const older = [...result.data].reverse()
        const currentViewport = getScrollViewport()
        const pendingPrepend = prependScrollRef.current
        if (pendingPrepend && currentViewport) {
          prependScrollRef.current = {
            ...pendingPrepend,
            scrollHeight: currentViewport.scrollHeight,
          }
        }
        setMessageWindow((previous) => {
          return mergeOlderMessagePage({
            currentMessages: previous.messages,
            olderMessages: older,
            pageSize: HISTORY_PAGE_SIZE,
            maxMessages: MAX_MESSAGES,
          })
        })
        setHistoryCommitId(requestId)
      } else if (result.success) {
        prependScrollRef.current = null
        setMessageWindow((previous) => ({
          ...previous,
          hasMore: false,
        }))
      } else {
        prependScrollRef.current = null
        setHistoryError(result.error ?? "Unable to load older messages.")
      }
    } catch (error: unknown) {
      if (isHistoryRequestCurrent(requestId, historyRequestIdRef.current)) {
        prependScrollRef.current = null
        setHistoryError(getHistoryLoadError(error))
      }
    } finally {
      if (isHistoryRequestCurrent(requestId, historyRequestIdRef.current)) {
        setLoading(false)
      }
    }
  }, [channelId, getScrollViewport, hasMore, loading, messages])

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
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ScrollArea className="h-full min-h-0 flex-1" ref={scrollRef}>
        <div className="flex flex-col gap-4 p-4">
          {hasMore && (
            <div className="flex justify-center" aria-live="polite" aria-busy={loading}>
              {historyError ? (
                <div className="flex flex-col items-center gap-2 text-center" role="alert">
                  <p className="text-sm text-destructive">{historyError}</p>
                  <Button type="button" variant="outline" size="sm" onClick={loadMoreMessages}>
                    Try again
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMoreMessages}
                  disabled={loading}
                >
                  {loading ? "Loading..." : "Load older messages"}
                </Button>
              )}
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
                  currentUserId={currentUserId}
                />
              ))}
            </div>
          ))}

          {typingUsers.length > 0 && <TypingIndicator users={typingUsers} />}
        </div>
      </ScrollArea>
      {!atNewestEdge && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg border shadow-lg"
          onClick={() => scrollToNewest("smooth")}
          aria-label="Jump to newest messages"
        >
          <ArrowDown className="size-4" />
          Newest messages
        </Button>
      )}
    </div>
  )
}
