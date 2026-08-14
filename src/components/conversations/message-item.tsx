"use client"

import * as React from "react"
import { formatDistanceToNow, format, parseISO } from "date-fns"
import {
  MessageSquare,
  Smile,
  Trash2,
  Paperclip,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useConversations } from "@/contexts/conversations-context"
import {
  addReaction,
  deleteMessage,
  removeReaction,
} from "@/app/actions/chat-messages"
import { useRouter } from "next/navigation"
import { normalizeConversationMentions } from "@/lib/conversations/message-content"
import { importedConversationContent } from "@/lib/conversations/imported-message-content"

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

type MessageItemProps = {
  readonly message: MessageData
  readonly showThreadAction?: boolean
}

function getRoleBadge(email: string) {
  if (email.includes("admin")) return { label: "Admin", variant: "destructive" as const }
  if (email.includes("bot") || email.includes("claude")) return { label: "Bot", variant: "secondary" as const }
  if (email.includes("office")) return { label: "Office", variant: "outline" as const }
  if (email.includes("field")) return { label: "Field", variant: "default" as const }
  if (email.includes("client")) return { label: "Client", variant: "secondary" as const }
  return null
}

function arePropsEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  const prevMsg = prev.message
  const nextMsg = next.message
  return (
    prevMsg.id === nextMsg.id &&
    prevMsg.content === nextMsg.content &&
    prevMsg.editedAt === nextMsg.editedAt &&
    prevMsg.isPinned === nextMsg.isPinned &&
    prevMsg.replyCount === nextMsg.replyCount &&
    prevMsg.deletedAt === nextMsg.deletedAt &&
    prevMsg.attachments?.length === nextMsg.attachments?.length &&
    prevMsg.reactions?.map((reaction) => `${reaction.emoji}:${reaction.count}`).join("|") ===
      nextMsg.reactions?.map((reaction) => `${reaction.emoji}:${reaction.count}`).join("|") &&
    prev.showThreadAction === next.showThreadAction
  )
}

export const MessageItem = React.memo(function MessageItem({
  message,
  showThreadAction = true,
}: MessageItemProps) {
  const [isHovered, setIsHovered] = React.useState(false)
  const [isFocused, setIsFocused] = React.useState(false)
  const [reactionOpen, setReactionOpen] = React.useState(false)
  const [reactionPending, setReactionPending] = React.useState(false)
  const { openThread } = useConversations()
  const router = useRouter()

  const user = message.user
  const displayName = user?.displayName ?? user?.email.split("@")[0] ?? "Unknown"
  const avatarFallback = displayName.substring(0, 2).toUpperCase()
  const roleBadge = user ? getRoleBadge(user.email) : null

  const timestamp = parseISO(message.createdAt)
  const isRecent = Date.now() - timestamp.getTime() < 24 * 60 * 60 * 1000
  const timeDisplay = isRecent
    ? formatDistanceToNow(timestamp, { addSuffix: true })
    : format(timestamp, "MMM d 'at' h:mm a")

  const handleDelete = async () => {
    if (!confirm("Delete this message?")) return
    const result = await deleteMessage(message.id)
    if (result.success) {
      router.refresh()
    }
  }

  const handleReply = () => {
    openThread(message.id, message)
  }

  async function toggleReaction(
    emoji: string,
    reactedByCurrentUser: boolean
  ): Promise<void> {
    if (reactionPending) return
    setReactionPending(true)
    const result = reactedByCurrentUser
      ? await removeReaction(message.id, emoji)
      : await addReaction(message.id, emoji)
    setReactionPending(false)
    setReactionOpen(false)
    if (result.success) router.refresh()
  }

  if (message.deletedAt) {
    return (
      <div className="group relative flex gap-3 px-4 py-2 hover:bg-muted/50">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="text-xs">{avatarFallback}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium">{displayName}</span>
            <span className="text-xs text-muted-foreground">{timeDisplay}</span>
          </div>
          <p className="text-sm italic text-muted-foreground">[Message deleted]</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="group relative flex gap-3 px-4 py-2 hover:bg-muted/50"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <Avatar className="h-8 w-8">
        {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={displayName} />}
        <AvatarFallback className="text-xs">{avatarFallback}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{displayName}</span>
          {roleBadge && (
            <Badge variant={roleBadge.variant} className="h-4 text-[10px] px-1">
              {roleBadge.label}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{timeDisplay}</span>
          {message.editedAt && (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
        </div>

        <div className="chat-markdown mt-1 text-sm">
          <MarkdownRenderer>
            {normalizeConversationMentions(
              importedConversationContent({
                id: message.id,
                content: message.content,
              })
            )}
          </MarkdownRenderer>
        </div>

        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 grid gap-1.5">
            {message.attachments.map((attachment) => (
              <a
                key={attachment.id}
                href={attachment.storageUrl}
                className="flex min-w-0 items-center gap-2 border-l-2 border-primary/40 px-2 py-1.5 text-xs hover:bg-muted/50"
              >
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {attachment.fileName}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {attachment.fileSize < 1024 * 1024
                    ? `${Math.max(1, Math.round(attachment.fileSize / 1024))} KB`
                    : `${(attachment.fileSize / (1024 * 1024)).toFixed(1)} MB`}
                </span>
              </a>
            ))}
          </div>
        )}

        {message.reactions && message.reactions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                onClick={() =>
                  toggleReaction(
                    reaction.emoji,
                    reaction.reactedByCurrentUser
                  )
                }
                disabled={reactionPending}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted",
                  reaction.reactedByCurrentUser &&
                    "border-primary/50 bg-primary/10"
                )}
                aria-label={`${reaction.reactedByCurrentUser ? "Remove" : "Add"} ${reaction.emoji} reaction`}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        )}

        {showThreadAction && message.replyCount > 0 && (
          <button
            className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
            onClick={handleReply}
          >
            <MessageSquare className="h-3 w-3" />
            <span>{message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}</span>
            {message.lastReplyAt && (
              <span className="text-muted-foreground">
                · Last reply {formatDistanceToNow(parseISO(message.lastReplyAt), { addSuffix: true })}
              </span>
            )}
          </button>
        )}
      </div>

      {(isHovered || isFocused || reactionOpen) && (
        <div className="absolute right-4 top-2 flex gap-1 rounded-md border bg-background p-1 shadow-sm">
          {showThreadAction && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleReply}
              aria-label="Reply to message"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
          )}
          <Popover open={reactionOpen} onOpenChange={setReactionOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Add reaction"
              >
                <Smile className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="top"
              className="flex w-auto gap-1 p-1.5"
            >
              {["👍", "❤️", "✅", "🎉", "👀", "🙏"].map((emoji) => {
                const existing = message.reactions?.find(
                  (reaction) => reaction.emoji === emoji
                )
                return (
                  <button
                    key={emoji}
                    type="button"
                    disabled={reactionPending}
                    onClick={() =>
                      toggleReaction(
                        emoji,
                        existing?.reactedByCurrentUser ?? false
                      )
                    }
                    className="flex size-8 items-center justify-center rounded-md text-base hover:bg-muted"
                    aria-label={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                )
              })}
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleDelete}
            aria-label="Delete message"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}, arePropsEqual)
