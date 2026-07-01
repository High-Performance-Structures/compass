"use client"

import * as React from "react"
import { formatDistanceToNow, format, parseISO } from "date-fns"
import {
  Download,
  ExternalLink,
  FileText,
  MessageSquare,
  Edit2,
  Smile,
  Trash2,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { cn } from "@/lib/utils"
import { useConversations } from "@/contexts/conversations-context"
import { editMessage, deleteMessage } from "@/app/actions/chat-messages"
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
  readonly attachments: readonly MessageAttachmentData[]
}

type MessageItemProps = {
  readonly message: MessageData
}

type MessageAttachmentData = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
  readonly storageProvider: string
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly downloadUrl: string | null
  readonly uploadedAt: string
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
    prevMsg.contentHtml === nextMsg.contentHtml &&
    prevMsg.editedAt === nextMsg.editedAt &&
    prevMsg.isPinned === nextMsg.isPinned &&
    prevMsg.replyCount === nextMsg.replyCount &&
    prevMsg.deletedAt === nextMsg.deletedAt &&
    prevMsg.attachments.length === nextMsg.attachments.length
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`
  const megabytes = kilobytes / 1024
  return `${megabytes.toFixed(1)} MB`
}

function isImageAttachment(attachment: MessageAttachmentData): boolean {
  return attachment.mimeType.toLowerCase().startsWith("image/")
}

function AttachmentActions({
  attachment,
}: {
  readonly attachment: MessageAttachmentData
}): React.ReactElement {
  return (
    <>
      {attachment.driveUrl && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          asChild
        >
          <a
            href={attachment.driveUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${attachment.fileName} in Google Drive`}
          >
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      )}
      {attachment.downloadUrl && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          asChild
        >
          <a
            href={attachment.downloadUrl}
            download={attachment.fileName}
            aria-label={`Download ${attachment.fileName}`}
          >
            <Download className="size-3.5" />
          </a>
        </Button>
      )}
    </>
  )
}

function MessageAttachment({
  attachment,
}: {
  readonly attachment: MessageAttachmentData
}): React.ReactElement {
  const isImage = isImageAttachment(attachment)

  if (isImage && attachment.downloadUrl) {
    return (
      <div className="overflow-hidden rounded-md border bg-background text-xs sm:max-w-lg">
        <a
          href={attachment.downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="block bg-muted/30"
          aria-label={`Open preview of ${attachment.fileName}`}
        >
          {/* Authenticated Drive proxy URL; next/image cannot optimize it reliably. */}
          <img
            src={attachment.downloadUrl}
            alt={attachment.fileName}
            className="max-h-64 w-full object-contain"
            loading="lazy"
          />
        </a>
        <div className="flex items-center gap-2 px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">
              {attachment.fileName}
            </p>
            <p className="text-muted-foreground">
              {formatFileSize(attachment.fileSize)}
            </p>
          </div>
          <AttachmentActions attachment={attachment} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-xs">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">
          {attachment.fileName}
        </p>
        <p className="text-muted-foreground">
          {formatFileSize(attachment.fileSize)}
        </p>
      </div>
      <AttachmentActions attachment={attachment} />
    </div>
  )
}

function MessageBody({
  content,
  contentHtml,
}: {
  readonly content: string
  readonly contentHtml: string | null
}): React.ReactElement {
  if (contentHtml) {
    return (
      <div
        className={cn(
          "chat-rich-message mt-1 text-sm [&>p]:mb-2 [&>p:last-child]:mb-0",
          "[&_.mention]:inline-flex [&_.mention]:items-center [&_.mention]:rounded-md",
          "[&_.mention]:bg-primary/10 [&_.mention]:px-1.5 [&_.mention]:py-0.5",
          "[&_.mention]:font-medium [&_.mention]:text-primary"
        )}
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />
    )
  }

  return (
    <div className="chat-markdown mt-1 text-sm">
      <MarkdownRenderer>{content}</MarkdownRenderer>
    </div>
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
        ) : (
          <MessageBody
            content={message.content}
            contentHtml={message.contentHtml}
          />
        )}

        {message.attachments.length > 0 && (
          <div className="mt-2 grid gap-1.5 sm:max-w-xl">
            {message.attachments.map((attachment) => (
              <MessageAttachment key={attachment.id} attachment={attachment} />
            ))}
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
