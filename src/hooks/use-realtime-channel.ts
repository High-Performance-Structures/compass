"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { z } from "zod/v4"
import { useVisibleInterval } from "@/hooks/use-visible-interval"

type TypingUser = {
  id: string
  displayName: string | null
}

type MessageData = {
  id: string
  channelId: string
  threadId: string | null
  content: string
  contentHtml: string | null
  editedAt: string | null
  deletedAt: string | null
  isPinned: boolean
  replyCount: number
  lastReplyAt: string | null
  createdAt: string
  user: {
    id: string
    displayName: string | null
    email: string
    avatarUrl: string | null
  } | null
}

type RealtimeUpdate = {
  newMessages: MessageData[]
  typingUsers: TypingUser[]
  isPolling: boolean
}

type PollingOptions = {
  readonly visibleInterval?: number
}

const DEFAULT_VISIBLE_POLL_INTERVAL = 2500 // 2.5 seconds while the tab is visible

const realtimeUpdateSchema = z.object({
  success: z.literal(true),
  data: z.object({
    messages: z.array(z.object({
      id: z.string(),
      channelId: z.string(),
      threadId: z.string().nullable(),
      content: z.string(),
      contentHtml: z.string().nullable(),
      editedAt: z.string().nullable(),
      deletedAt: z.string().nullable(),
      isPinned: z.boolean(),
      replyCount: z.number(),
      lastReplyAt: z.string().nullable(),
      createdAt: z.string(),
      user: z.object({
        id: z.string(),
        displayName: z.string().nullable(),
        email: z.string(),
        avatarUrl: z.string().nullable(),
      }).nullable(),
    })),
    typingUsers: z.array(z.object({
      id: z.string(),
      displayName: z.string().nullable(),
    })),
  }),
})

function isTransientFetchError(error: unknown): boolean {
  return error instanceof TypeError && error.message === "Failed to fetch"
}

export function useRealtimeChannel(
  channelId: string,
  lastMessageId: string | null,
  options?: PollingOptions,
): RealtimeUpdate {
  const [newMessages, setNewMessages] = useState<MessageData[]>([])
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const [isPolling, setIsPolling] = useState(false)

  const lastMessageIdRef = useRef(lastMessageId)

  const visibleInterval = options?.visibleInterval ?? DEFAULT_VISIBLE_POLL_INTERVAL

  // keep lastMessageId ref in sync
  useEffect(() => {
    lastMessageIdRef.current = lastMessageId
  }, [lastMessageId])

  const poll = useCallback(async () => {
    setIsPolling(true)

    try {
      const search = new URLSearchParams()
      if (lastMessageIdRef.current) {
        search.set("lastMessageId", lastMessageIdRef.current)
      }
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(channelId)}/updates?${search.toString()}`,
        { cache: "no-store" },
      )
      const result = realtimeUpdateSchema.safeParse(await response.json())
      if (!response.ok || !result.success) {
        throw new Error("Unable to refresh conversation messages.")
      }

      // Accumulate new messages while avoiding duplicates. With no baseline,
      // the endpoint returns the latest messages so an initially empty thread
      // can receive its first reply without a full page reload.
      if (result.data.data.messages.length > 0) {
        setNewMessages((prev) => {
          const existingIds = new Set(prev.map((message) => message.id))
          const uniqueNew = result.data.data.messages.filter(
            (message) => !existingIds.has(message.id),
          )
          return [...prev, ...uniqueNew]
        })
      }

      setTypingUsers(result.data.data.typingUsers)
    } catch (error) {
      if (isTransientFetchError(error)) {
        return
      }

      console.error("[useRealtimeChannel] poll error:", error)
    } finally {
      setIsPolling(false)
    }
  }, [channelId])

  // Poll right away for a new channel or a new newest message (after a send
  // or an arrival). Hidden tabs wait; the visible poll catches up on return.
  useEffect(() => {
    if (document.visibilityState === "hidden") return
    void poll()
  }, [lastMessageId, poll])

  // Nothing reads messages in a hidden tab: marking read waits for the tab to
  // be visible and alerts come from the bell and push. So hidden tabs stop
  // polling instead of slowing down.
  useVisibleInterval(() => void poll(), visibleInterval, { immediate: false })

  return {
    newMessages,
    typingUsers,
    isPolling,
  }
}
