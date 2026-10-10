"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react"
import { useRouter } from "next/navigation"
import { IconBell } from "@tabler/icons-react"

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
import { announceNotificationsChanged, NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notifications/client-events"
import { InboxRowItem } from "@/components/notifications/inbox-row"
import { portfolioMessagesHref } from "@/lib/notifications/message-stacks"
import { cn } from "@/lib/utils"

type Row = InboxRow<NotificationCenterItem>
type View = "unread" | "all"

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
  showOnMap,
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
  /** Office bell only: link a project section to its job on the dashboard map. */
  readonly showOnMap: ((projectId: string) => void) | null
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
                <span className="flex shrink-0 items-center gap-2">
                  {section.unreadCount > 0 && (
                    <span className="text-xs font-medium text-primary">
                      {section.unreadCount} new
                    </span>
                  )}
                  {showOnMap && section.key !== "general" && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      onClick={() => showOnMap(section.key)}
                    >
                      Show on map
                    </button>
                  )}
                </span>
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
  // Urgent reminders (e.g. a stale Message Desk message) turn the bell red until read.
  const hasUrgentUnread = useMemo(
    () => notifications.some((item) => item.readAt === null && item.priority === "urgent"),
    [notifications]
  )

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
      announceNotificationsChanged()
    }
  }

  async function clearRead(): Promise<void> {
    const result = await dismissReadNotifications(notificationScope)
    if (result.success) {
      setNotifications((items) => items.filter((item) => item.readAt === null))
      announceNotificationsChanged()
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
    // Keeps the map's Messages layer in step with the bell.
    announceNotificationsChanged()
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
    else announceNotificationsChanged()
  }

  async function undoDone(): Promise<void> {
    if (!undo) return
    const { ids } = undo
    setUndo(null)
    await setNotificationsDismissed(ids, false, notificationScope)
    announceNotificationsChanged()
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
    <Button
      variant="ghost"
      size="icon"
      className={cn("relative size-8", hasUrgentUnread && "text-destructive hover:text-destructive")}
      aria-label={hasUrgentUnread ? "Notifications, urgent reminder waiting" : "Notifications"}
    >
      <BadgeIndicator dot={hasUnread}>
        <IconBell className="size-4" />
      </BadgeIndicator>
      {unreadCount > 0 && (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 rounded-full px-1 text-xs font-semibold leading-4",
            hasUrgentUnread ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"
          )}
        >
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
      showOnMap={
        notificationScope
          ? null
          : (projectId) => {
              setOpen(false)
              router.push(portfolioMessagesHref(projectId))
            }
      }
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
