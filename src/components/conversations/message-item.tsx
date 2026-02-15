"use client"

import * as React from "react"
import { formatDistanceToNow, format, parseISO } from "date-fns"
import {
  MessageSquare,
  Smile,
  Edit2,
  Trash2,
  MoreHorizontal,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { cn } from "@/lib/utils"
import { useConversations } from "@/app/dashboard/conversations/layout"
import { editMessage, deleteMessage, addReaction } from "@/app/actions/chat-messages"
import { useRouter } from "next/navigation"

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
  readonly user: {
    readonly id: string
    readonly displayName: string | null
    readonly email: string
    readonly avatarUrl: string | null
  } | null
}

type MessageItemProps = {
  readonly message: MessageData
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
    prevMsg.deletedAt === nextMsg.deletedAt
  )
}

export const MessageItem = React.memo(function MessageItem({ message }: MessageItemProps) {
  const [isEditing, setIsEditing] = React.useState(false)
  const [editContent, setEditContent] = React.useState(message.content)
  const [isHovered, setIsHovered] = React.useState(false)
  const [isFocused, setIsFocused] = React.useState(false)
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

  const handleEdit = async () => {
    if (editContent.trim() === message.content) {
      setIsEditing(false)
      return
    }

    const result = await editMessage(message.id, editContent.trim())
    if (result.success) {
      setIsEditing(false)
      router.refresh()
    }
  }

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

        {isEditing ? (
          <div className="mt-2 space-y-2">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[80px]"
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleEdit}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditContent(message.content)
                  setIsEditing(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : message.contentHtml ? (
          <div
            className="mt-1 text-sm prose prose-sm dark:prose-invert max-w-none
              prose-p:my-1 prose-p:leading-relaxed
              prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-sm
              prose-pre:bg-muted prose-pre:p-3 prose-pre:rounded-md prose-pre:overflow-x-auto
              prose-a:text-primary prose-a:no-underline hover:prose-a:underline
              prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
              prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: message.contentHtml }}
          />
        ) : (
          <div className="mt-1 text-sm">
            <MarkdownRenderer>{message.content}</MarkdownRenderer>
          </div>
        )}

        {message.replyCount > 0 && (
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

      {(isHovered || isFocused) && !isEditing && (
        <div className="absolute right-4 top-2 flex gap-1 rounded-md border bg-background p-1 shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleReply}
            aria-label="Reply to message"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled
            aria-label="Add reaction"
          >
            <Smile className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsEditing(true)}
            aria-label="Edit message"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
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
