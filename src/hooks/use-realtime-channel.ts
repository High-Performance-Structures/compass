"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { z } from "zod/v4"

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
  visibleInterval?: number
  hiddenInterval?: number
}

const DEFAULT_VISIBLE_POLL_INTERVAL = 2500 // 2.5 seconds when tab is visible
const DEFAULT_HIDDEN_POLL_INTERVAL = 10000 // 10 seconds when tab is hidden

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

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isVisibleRef = useRef(true)
  const lastMessageIdRef = useRef(lastMessageId)

  const visibleInterval = options?.visibleInterval ?? DEFAULT_VISIBLE_POLL_INTERVAL
  const hiddenInterval = options?.hiddenInterval ?? DEFAULT_HIDDEN_POLL_INTERVAL

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

  // handle visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === "visible"

      // restart polling with correct interval when visibility changes
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }

      const interval = isVisibleRef.current
        ? visibleInterval
        : hiddenInterval

      pollingRef.current = setInterval(poll, interval)
      // also poll immediately when becoming visible
      if (isVisibleRef.current) {
        poll()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [poll, visibleInterval, hiddenInterval])

  // main polling setup
  useEffect(() => {
    // clear any existing interval
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    const interval = isVisibleRef.current
      ? visibleInterval
      : hiddenInterval

    // initial poll
    poll()

    // set up interval
    pollingRef.current = setInterval(poll, interval)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [channelId, lastMessageId, poll, visibleInterval, hiddenInterval])

  return {
    newMessages,
    typingUsers,
    isPolling,
  }
}
