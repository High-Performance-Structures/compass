"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { getChannelUpdates } from "@/app/actions/conversations-realtime"

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
    role: string
    avatarUrl: string | null
  } | null
  attachments: readonly {
    readonly id: string
    readonly fileName: string
    readonly mimeType: string
    readonly fileSize: number
    readonly storageProvider: string
    readonly driveFileId: string | null
    readonly driveUrl: string | null
    readonly downloadUrl: string | null
    readonly uploadedAt: string
  }[]
  reactions: readonly {
    readonly emoji: string
    readonly count: number
    readonly reactedByCurrentUser: boolean
  }[]
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
    // don't poll without a baseline message to compare against
    if (!lastMessageIdRef.current) {
      return
    }

    setIsPolling(true)

    try {
      const result = await getChannelUpdates(
        channelId,
        lastMessageIdRef.current ?? undefined,
      )

      if (result.success) {
        // accumulate new messages (avoid duplicates)
        if (result.data.messages.length > 0) {
          setNewMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id))
            const uniqueNew = result.data.messages.filter(
              (m) => !existingIds.has(m.id),
            )
            return [...prev, ...uniqueNew]
          })
        }

        setTypingUsers(result.data.typingUsers)
      }
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

      // only start polling if we have a lastMessageId
      if (lastMessageIdRef.current) {
        const interval = isVisibleRef.current
          ? visibleInterval
          : hiddenInterval

        pollingRef.current = setInterval(poll, interval)
        // also poll immediately when becoming visible
        if (isVisibleRef.current) {
          poll()
        }
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

    // only start polling when we have messages to compare against
    if (!lastMessageId) {
      return
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
