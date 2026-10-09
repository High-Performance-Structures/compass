"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconAlertCircle,
  IconArchive,
  IconBell,
  IconCheck,
  IconClipboardCheck,
  IconClock,
  IconHeart,
  IconMessageCircle,
  IconMessages,
  IconPhone,
} from "@tabler/icons-react"

import {
  dismissReadNotifications,
  getNotificationCenter,
  markAllNotificationsRead,
  markNotificationRead,
  setNotificationsDismissed,
  type NotificationCenterItem,
  type NotificationCenterScope,
} from "@/app/actions/notifications"
import { Button } from "@/components/ui/button"
import { BadgeIndicator } from "@/components/ui/badge-indicator"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { useConversationPanelOptional } from "@/components/conversations/conversation-panel-provider"
import { notificationPanelChannelId } from "@/lib/conversations/notification-route"
import {
  groupInbox,
  type InboxRow,
  type InboxSection,
} from "@/lib/notifications/inbox"
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notifications/client-events"
import { cn } from "@/lib/utils"

type Row = InboxRow<NotificationCenterItem>
type View = "unread" | "all"

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

function InboxRowItem({
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

function InboxPanel({
  sections,
  view,
  onViewChange,
  totalUnread,
  hasRead,
  loading,
  undo,
  onUndo,
  onMarkAllRead,
  onClearRead,
  onNavigate,
  onMarkRead,
  onDone,
}: {
  readonly sections: readonly InboxSection<NotificationCenterItem>[]
  readonly view: View
  readonly onViewChange: (view: View) => void
  readonly totalUnread: number
  readonly hasRead: boolean
  readonly loading: boolean
  readonly undo: { readonly count: number } | null
  readonly onUndo: () => void
  readonly onMarkAllRead: () => void
  readonly onClearRead: () => void
  readonly onNavigate: (row: Row, event: MouseEvent<HTMLAnchorElement>) => void
  readonly onMarkRead: (row: Row) => void
  readonly onDone: (row: Row) => void
}) {
  const visible = sections
    .map((section) => ({
      ...section,
      rows: view === "unread" ? section.rows.filter((row) => row.unreadCount > 0) : section.rows,
    }))
    .filter((section) => section.rows.length > 0)
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <div role="tablist" aria-label="Notifications view" className="flex gap-1">
          {(["unread", "all"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              onClick={() => onViewChange(option)}
              className={cn(
                "h-8 rounded-md px-2.5 text-xs font-medium transition-colors",
                view === option ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option === "unread" ? `Unread${totalUnread > 0 ? ` · ${totalUnread}` : ""}` : "All"}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          disabled={totalUnread === 0}
          onClick={onMarkAllRead}
        >
          Mark all read
        </Button>
      </div>
      <div className="max-h-[65vh] overflow-y-auto">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Loading notifications...
          </div>
        ) : visible.length > 0 ? (
          visible.map((section) => (
            <section key={section.key} aria-label={section.label} className="border-b last:border-0">
              <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-popover/95 px-4 pb-1 pt-2.5 backdrop-blur">
                <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.label}
                </span>
                {section.unreadCount > 0 && (
                  <span className="shrink-0 text-xs font-medium text-primary">
                    {section.unreadCount} new
                  </span>
                )}
              </div>
              <ul className="pb-1">
                {section.rows.map((row) => (
                  <InboxRowItem
                    key={row.key}
                    row={row}
                    onNavigate={onNavigate}
                    onMarkRead={onMarkRead}
                    onDone={onDone}
                  />
                ))}
              </ul>
            </section>
          ))
        ) : (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium">
              {view === "unread" ? "You're all caught up" : "Nothing here"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {view === "unread" && hasRead
                ? "Read items are under All until you clear them."
                : "New activity will show up here."}
            </p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
        {undo ? (
          <>
            <span className="text-xs text-muted-foreground" role="status">
              {undo.count === 1 ? "Marked done" : `${undo.count} marked done`}
            </span>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onUndo}>
              Undo
            </Button>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">Read items clear after 30 days</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              disabled={!hasRead}
              onClick={onClearRead}
            >
              Clear read
            </Button>
          </>
        )}
      </div>
    </>
  )
}

export function NotificationsPopover({
  scope,
}: {
  readonly scope?: NotificationCenterScope
}) {
  const isMobile = useIsMobile()
  const conversationPanel = useConversationPanelOptional()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>("unread")
  const [undo, setUndo] = useState<{ readonly ids: readonly string[]; readonly count: number } | null>(null)
  const undoTimerRef = useRef<number | null>(null)
  const router = useRouter()
  const [notifications, setNotifications] = useState<
    readonly NotificationCenterItem[]
  >([])
  const mountedRef = useRef(true)
  const requestSequenceRef = useRef(0)
  const scopedProjectId = scope?.projectId
  const scopedAudience = scope?.audience
  const notificationScope = useMemo(
    () =>
      scopedProjectId && scopedAudience
        ? { projectId: scopedProjectId, audience: scopedAudience }
        : undefined,
    [scopedAudience, scopedProjectId]
  )
  const unreadCount = useMemo(
    () => notifications.filter((item) => item.readAt === null).length,
    [notifications]
  )
  const hasRead = useMemo(
    () => notifications.some((item) => item.readAt !== null),
    [notifications]
  )
  const sections = useMemo(() => groupInbox(notifications), [notifications])
  const hasUnread = unreadCount > 0

  const loadNotifications = useCallback(
    async (showLoading: boolean): Promise<void> => {
      const requestSequence = ++requestSequenceRef.current
      if (showLoading) setLoading(true)
      try {
        const result = await getNotificationCenter(notificationScope)
        if (
          !mountedRef.current ||
          requestSequence !== requestSequenceRef.current
        ) {
          return
        }
        if (result.success) {
          setNotifications(result.data.items)
        } else if (notificationScope) {
          setNotifications([])
        }
      } catch {
        if (
          mountedRef.current &&
          requestSequence === requestSequenceRef.current &&
          notificationScope
        ) {
          // External workspaces fail closed so stale items cannot cross scopes.
          setNotifications([])
        }
      } finally {
        if (
          mountedRef.current &&
          requestSequence === requestSequenceRef.current
        ) {
          setLoading(false)
        }
      }
    },
    [notificationScope]
  )

  useEffect(() => {
    mountedRef.current = true
    void loadNotifications(true)
    const intervalId = window.setInterval(() => {
      // Hidden tabs skip the poll; returning to the tab refreshes immediately.
      if (document.visibilityState !== "visible") return
      void loadNotifications(false)
    }, 15_000)
    function refreshWhenVisible(): void {
      if (document.visibilityState === "visible") {
        void loadNotifications(false)
      }
    }
    // Reading a conversation elsewhere clears its items; refresh right away.
    function refreshNow(): void {
      void loadNotifications(false)
    }
    window.addEventListener("focus", refreshWhenVisible)
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshNow)
    document.addEventListener(
      "visibilitychange",
      refreshWhenVisible
    )
    return () => {
      mountedRef.current = false
      requestSequenceRef.current += 1
      window.clearInterval(intervalId)
      window.removeEventListener("focus", refreshWhenVisible)
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshNow)
      document.removeEventListener(
        "visibilitychange",
        refreshWhenVisible
      )
    }
  }, [loadNotifications])

  useEffect(() => () => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
  }, [])

  function changeOpen(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen) {
      setView(unreadCount > 0 ? "unread" : "all")
      void loadNotifications(false)
    } else {
      setUndo(null)
    }
  }

  function markLocallyRead(ids: ReadonlySet<string>): void {
    const now = new Date().toISOString()
    setNotifications((items) =>
      items.map((item) =>
        ids.has(item.id) && item.readAt === null ? { ...item, readAt: now } : item
      )
    )
  }

  async function markAllRead(): Promise<void> {
    const result = await markAllNotificationsRead(notificationScope)
    if (result.success) {
      markLocallyRead(new Set(notifications.map((item) => item.id)))
    }
  }

  async function clearRead(): Promise<void> {
    const result = await dismissReadNotifications(notificationScope)
    if (result.success) {
      setNotifications((items) => items.filter((item) => item.readAt === null))
    }
  }

  async function markRowRead(row: Row): Promise<void> {
    const unread = row.items.filter((item) => item.readAt === null)
    if (unread.length === 0) return
    markLocallyRead(new Set(unread.map((item) => item.id)))
    await Promise.all(
      unread.map((item) =>
        markNotificationRead(item.id, notificationScope).catch(() => undefined)
      )
    )
  }

  async function markRowDone(row: Row): Promise<void> {
    const ids = row.items.map((item) => item.id)
    const removed = new Set(ids)
    setNotifications((items) => items.filter((item) => !removed.has(item.id)))
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    setUndo({ ids, count: row.items.length })
    undoTimerRef.current = window.setTimeout(() => setUndo(null), 6000)
    const result = await setNotificationsDismissed(ids, true, notificationScope)
    if (!result.success) void loadNotifications(false)
  }

  async function undoDone(): Promise<void> {
    if (!undo) return
    const { ids } = undo
    setUndo(null)
    await setNotificationsDismissed(ids, false, notificationScope)
    void loadNotifications(false)
  }

  async function navigate(
    row: Row,
    event: MouseEvent<HTMLAnchorElement>
  ): Promise<void> {
    const item = row.latest
    const channelId = notificationPanelChannelId({
      href: item.href,
      isMobile,
      hasConversationPanel: conversationPanel !== null,
    })
    const isPlainClick =
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey

    if (isPlainClick) {
      // Route before closing the popover removes its Link. Reading status is independent of navigation.
      event.preventDefault()
      if (channelId) conversationPanel?.open(channelId)
      else router.push(item.href)
    }

    setOpen(false)
    await markRowRead(row)
  }

  const trigger = (
    <Button variant="ghost" size="icon" className="relative size-8" aria-label="Notifications">
      <BadgeIndicator dot={hasUnread}>
        <IconBell className="size-4" />
      </BadgeIndicator>
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-xs font-semibold leading-4 text-primary-foreground">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Button>
  )

  const panel = (
    <InboxPanel
      sections={sections}
      view={view}
      onViewChange={setView}
      totalUnread={unreadCount}
      hasRead={hasRead}
      loading={loading}
      undo={undo}
      onUndo={() => void undoDone()}
      onMarkAllRead={() => void markAllRead()}
      onClearRead={() => void clearRead()}
      onNavigate={(row, event) => void navigate(row, event)}
      onMarkRead={(row) => void markRowRead(row)}
      onDone={(row) => void markRowDone(row)}
    />
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={changeOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="p-0" showClose={false}>
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="text-base font-medium">
              Notifications
            </SheetTitle>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Notifications</p>
        </div>
        {panel}
      </PopoverContent>
    </Popover>
  )
}
