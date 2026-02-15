"use client"

import * as React from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { useConversations, type ThreadMessage } from "@/contexts/conversations-context"
import { getThreadMessages } from "@/app/actions/chat-messages"
import { MessageItem } from "./message-item"
import { MessageComposer } from "./message-composer"
import { useIsMobile } from "@/hooks/use-mobile"

export function ThreadPanel() {
  const { threadOpen, threadMessageId, threadParentMessage, closeThread } = useConversations()
  const isMobile = useIsMobile()
  const [replies, setReplies] = React.useState<readonly ThreadMessage[]>([])
  const [loading, setLoading] = React.useState(false)
  const [panelWidth, setPanelWidth] = React.useState(400)
  const [isResizing, setIsResizing] = React.useState(false)
  const dragStartX = React.useRef(0)
  const dragStartWidth = React.useRef(0)

  React.useEffect(() => {
    if (!threadMessageId) {
      setReplies([])
      return
    }

    setLoading(true)
    getThreadMessages(threadMessageId).then((result) => {
      if (result.success && result.data) {
        // replies come DESC from server; reverse for chronological
        setReplies([...result.data].reverse())
      }
      setLoading(false)
    })
  }, [threadMessageId])

  // resize handlers (follow ChatPanelShell pattern)
  React.useEffect(() => {
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

  const handleResizeStart = React.useCallback(
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

  const refreshReplies = React.useCallback(() => {
    if (!threadMessageId) return
    getThreadMessages(threadMessageId).then((result) => {
      if (result.success && result.data) {
        setReplies([...result.data].reverse())
      }
    })
  }, [threadMessageId])

  if (!threadOpen) return null

  return (
    <>
      {isMobile && threadOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={closeThread}
          aria-hidden="true"
        />
      )}

      <div
        className={cn(
          "flex flex-col border-l bg-background",
          "transition-[width,opacity,transform] duration-300 ease-in-out",
          isMobile
            ? "fixed inset-0 z-50"
            : "relative shrink-0",
          isResizing && "transition-none",
          threadOpen ? "opacity-100" : "w-0 opacity-0 border-transparent"
        )}
        style={!isMobile && threadOpen ? { width: panelWidth } : undefined}
      >
        {!isMobile && threadOpen && (
          <div
            className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-border/60 active:bg-border"
            onMouseDown={handleResizeStart}
          />
        )}

        <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <h2 className="text-base font-semibold">Thread</h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={closeThread}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading thread...</p>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1">
              <div className="p-4">
                {threadParentMessage && (
                  <>
                    <div className="mb-2 text-xs font-medium text-muted-foreground">
                      Original message
                    </div>
                    <div className="rounded-lg border bg-muted/50 p-2">
                      <MessageItem message={threadParentMessage} />
                    </div>
                    <Separator className="my-4" />
                    <div className="mb-2 text-xs font-medium text-muted-foreground">
                      {replies.length} {replies.length === 1 ? "reply" : "replies"}
                    </div>
                  </>
                )}

                {replies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No replies yet. Start the discussion!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {replies.map((reply) => (
                      <MessageItem key={reply.id} message={reply} />
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>

            {threadParentMessage && (
              <MessageComposer
                channelId={threadParentMessage.channelId}
                channelName="thread"
                threadId={threadMessageId ?? undefined}
                placeholder="Reply to thread..."
                onSent={refreshReplies}
              />
            )}
          </>
        )}
      </div>
    </>
  )
}
