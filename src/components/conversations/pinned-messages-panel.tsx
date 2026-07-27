"use client"

import * as React from "react"
import { formatDistanceToNow, format, parseISO } from "date-fns"
import { IconPin, IconPinnedOff, IconLoader2 } from "@tabler/icons-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getPinnedMessages, unpinMessage } from "@/app/actions/message-search"
import { normalizeConversationMentions } from "@/lib/conversations/message-content"

type PinnedMessage = {
  id: string
  channelId: string
  threadId: string | null
  content: string
  contentHtml: string | null
  editedAt: string | null
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

type PinnedMessagesPanelProps = {
  channelId: string
  isOpen: boolean
  onClose: () => void
  onJumpToMessage?: (messageId: string) => void
}

export function PinnedMessagesPanel({
  channelId,
  isOpen,
  onClose,
  onJumpToMessage,
}: PinnedMessagesPanelProps) {
  const [messages, setMessages] = React.useState<PinnedMessage[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [unpinningId, setUnpinningId] = React.useState<string | null>(null)

  // fetch pinned messages when panel opens
  React.useEffect(() => {
    async function fetchPinned() {
      if (!isOpen || !channelId) return

      setIsLoading(true)
      setError(null)

      const result = await getPinnedMessages(channelId)

      if (result.success) {
        setMessages(result.data as PinnedMessage[])
      } else {
        setError(result.error)
        setMessages([])
      }

      setIsLoading(false)
    }

    fetchPinned()
  }, [channelId, isOpen])

  const handleUnpin = async (messageId: string) => {
    setUnpinningId(messageId)
    const result = await unpinMessage(messageId)
    setUnpinningId(null)

    if (result.success) {
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
    } else {
      // show error briefly - could use toast here
      console.error("Failed to unpin:", result.error)
    }
  }

  const handleMessageClick = (message: PinnedMessage) => {
    if (onJumpToMessage) {
      onJumpToMessage(message.id)
      onClose()
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <IconPin className="size-5" />
            Pinned Messages
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100vh-8rem)]">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {!isLoading && !error && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <IconPin className="mb-2 size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No pinned messages in this channel
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Important messages can be pinned for easy reference
              </p>
            </div>
          )}

          {!isLoading && !error && messages.length > 0 && (
            <div className="space-y-3 pr-4">
              {messages.map((message) => {
                const displayName =
                  message.user?.displayName ??
                  message.user?.email?.split("@")[0] ??
                  "Unknown User"
                const avatarFallback = displayName.substring(0, 2).toUpperCase()
                const timestamp = parseISO(message.createdAt)
                const isRecent =
                  Date.now() - timestamp.getTime() < 24 * 60 * 60 * 1000
                const timeDisplay = isRecent
                  ? formatDistanceToNow(timestamp, { addSuffix: true })
                  : format(timestamp, "MMM d, yyyy 'at' h:mm a")

                return (
                  <div
                    key={message.id}
                    className="group rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="mt-0.5 h-8 w-8 shrink-0">
                        {message.user?.avatarUrl && (
                          <AvatarImage
                            src={message.user.avatarUrl}
                            alt={displayName}
                          />
                        )}
                        <AvatarFallback className="text-xs">
                          {avatarFallback}
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {displayName}
                          </span>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={() => handleUnpin(message.id)}
                              disabled={unpinningId === message.id}
                              aria-label="Unpin message"
                            >
                              {unpinningId === message.id ? (
                                <IconLoader2 className="size-3 animate-spin" />
                              ) : (
                                <IconPinnedOff className="size-3 text-muted-foreground" />
                              )}
                            </Button>
                          </div>
                        </div>

                        <button
                          className="mt-1 w-full cursor-pointer text-left text-sm"
                          onClick={() => handleMessageClick(message)}
                        >
                          <p className="line-clamp-3 text-muted-foreground">
                            {normalizeConversationMentions(message.content)}
                          </p>
                        </button>

                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{timeDisplay}</span>
                          {message.editedAt && (
                            <span className="opacity-60">(edited)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
