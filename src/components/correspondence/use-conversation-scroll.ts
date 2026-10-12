"use client"

import * as React from "react"
import { getNewestScrollTop, getPreservedScrollTop, isAtNewestEdge } from "@/components/conversations/message-list-behavior"

type ScrollSnapshot = {
  readonly conversationId: string
  readonly firstId: string | null
  readonly scrollTop: number
  readonly scrollHeight: number
}

type ConversationScroll = {
  readonly viewportRef: React.RefObject<HTMLDivElement | null>
  readonly contentRef: React.RefObject<HTMLDivElement | null>
  readonly atNewest: boolean
  readonly jumpToNewest: () => void
}

/** Keeps the reader's position when history or polling changes a conversation. */
export function useConversationScroll({ conversationId, firstId, lastId, messageCount, ready, targetMessageId }: {
  readonly conversationId: string
  readonly firstId: string | null
  readonly lastId: string | null
  readonly messageCount: number
  readonly ready: boolean
  readonly targetMessageId: string | undefined
}): ConversationScroll {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const snapshot = React.useRef<ScrollSnapshot | null>(null)
  const followsNewest = React.useRef(true)
  const [atNewest, setAtNewest] = React.useState(true)

  const jumpToNewest = React.useCallback((): void => {
    const viewport = viewportRef.current
    if (viewport === null) return
    // Set intent synchronously so a pending older-page completion follows it.
    followsNewest.current = true
    viewport.scrollTop = getNewestScrollTop(viewport)
    setAtNewest(true)
    const previous = snapshot.current
    if (previous !== null) snapshot.current = { ...previous, scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight }
  }, [])

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null) return
    const previous = snapshot.current
    const changedConversation = previous?.conversationId !== conversationId
    if (changedConversation) followsNewest.current = targetMessageId === undefined
    if (targetMessageId !== undefined) followsNewest.current = false
    if (ready && followsNewest.current) {
      viewport.scrollTop = getNewestScrollTop(viewport)
    } else if (ready && previous !== null && !changedConversation && previous.firstId !== null && firstId !== previous.firstId && targetMessageId === undefined) {
      // Measure at commit, not request start; manual scrolling during a load wins.
      viewport.scrollTop = getPreservedScrollTop({ scrollTop: previous.scrollTop, previousScrollHeight: previous.scrollHeight, nextScrollHeight: viewport.scrollHeight })
    }
    snapshot.current = { conversationId, firstId, scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight }
    const newest = isAtNewestEdge(viewport)
    setAtNewest(newest)
  }, [conversationId, firstId, lastId, messageCount, ready, targetMessageId])

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null) return
    const recordScroll = (): void => {
      const newest = isAtNewestEdge(viewport)
      followsNewest.current = newest
      setAtNewest(newest)
      const previous = snapshot.current
      if (previous !== null) snapshot.current = { ...previous, scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight }
    }
    viewport.addEventListener("scroll", recordScroll)
    // Images, previews, the composer, and window resizing can change height.
    const resize = new ResizeObserver(() => {
      if (followsNewest.current) viewport.scrollTop = getNewestScrollTop(viewport)
      const previous = snapshot.current
      if (previous !== null) snapshot.current = { ...previous, scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight }
      setAtNewest(isAtNewestEdge(viewport))
    })
    resize.observe(viewport)
    if (contentRef.current !== null) resize.observe(contentRef.current)
    return () => { viewport.removeEventListener("scroll", recordScroll); resize.disconnect() }
  }, [ready, conversationId])

  return { viewportRef, contentRef, atNewest, jumpToNewest }
}
