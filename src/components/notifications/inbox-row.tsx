"use client"

import type { MouseEvent } from "react"
import Link from "next/link"
import {
  IconAlertCircle,
  IconArchive,
  IconCheck,
  IconClipboardCheck,
  IconClock,
  IconHeart,
  IconMessageCircle,
  IconMessages,
  IconPhone,
} from "@tabler/icons-react"

import type { NotificationCenterItem } from "@/app/actions/notifications"
import { Button } from "@/components/ui/button"
import type { InboxRow } from "@/lib/notifications/inbox"
import { cn } from "@/lib/utils"

export type NotificationRow = InboxRow<NotificationCenterItem>
type Row = NotificationRow

function iconFor(item: NotificationCenterItem, stacked: boolean): typeof IconClipboardCheck {
  if (stacked) return IconMessages
  if (item.sourceType === "message" || item.sourceType === "project_correspondence") {
    return IconMessageCircle
  }
  if (item.eventType.startsWith("cherish.")) return IconHeart
  if (item.eventType.startsWith("staff_message.")) return IconPhone
  if (item.eventType.startsWith("rfi.")) return IconMessageCircle
  if (item.priority === "high") return IconAlertCircle
  if (item.eventType.startsWith("schedule.")) return IconClock
  return IconClipboardCheck
}

function relativeTime(value: string): string {
  const createdAt = new Date(value).getTime()
  const diffMs = Date.now() - createdAt
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now"
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function rowSummary(row: Row): string | null {
  if (row.items.length < 2) return null
  return row.unreadCount > 0
    ? `${row.unreadCount} new of ${row.items.length} messages`
    : `${row.items.length} messages`
}

/** One bell row: a single item or a conversation's items stacked. Shared by the bell and the map. */
export function InboxRowItem({
  row,
  onNavigate,
  onMarkRead,
  onDone,
}: {
  readonly row: Row
  readonly onNavigate: (row: Row, event: MouseEvent<HTMLAnchorElement>) => void
  readonly onMarkRead: (row: Row) => void
  readonly onDone: (row: Row) => void
}) {
  const { latest } = row
  const unread = row.unreadCount > 0
  const stacked = row.items.length > 1
  const Icon = iconFor(latest, stacked)
  const summary = rowSummary(row)
  return (
    <li className="group relative">
      <Link
        href={latest.href}
        onClick={(event) => onNavigate(row, event)}
        className="flex gap-3 px-4 py-2.5 pr-20 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
      >
        <span
          className={cn(
            "relative mt-0.5 grid size-8 shrink-0 place-items-center rounded-md",
            unread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="size-4" />
          {stacked && (
            <span className="absolute -bottom-1 -right-1 min-w-4 rounded-full border border-background bg-foreground px-1 text-center text-xs font-semibold leading-4 text-background">
              {row.items.length > 9 ? "9+" : row.items.length}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium text-muted-foreground")}>
              {latest.title}
            </span>
          </span>
          <span className="line-clamp-1 break-words text-xs text-muted-foreground">
            {latest.body}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {unread && <span aria-hidden className="size-1.5 rounded-full bg-primary" />}
            <span>{relativeTime(latest.createdAt)}</span>
            {summary && <span>· {summary}</span>}
          </span>
        </span>
      </Link>
      {/* Quick actions: always visible on touch, on hover or focus otherwise. */}
      <div className="absolute right-2 top-2.5 flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        {unread && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={stacked ? "Mark these read" : "Mark read"}
            title="Mark read"
            onClick={() => onMarkRead(row)}
          >
            <IconCheck className="size-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={stacked ? "Done with these" : "Done"}
          title="Done"
          onClick={() => onDone(row)}
        >
          <IconArchive className="size-4" />
        </Button>
      </div>
    </li>
  )
}

