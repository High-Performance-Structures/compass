"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  IconAlertCircle,
  IconBell,
  IconClipboardCheck,
  IconClock,
  IconMessageCircle,
} from "@tabler/icons-react"

import {
  getNotificationCenter,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationCenterItem,
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

function iconFor(item: NotificationCenterItem): typeof IconClipboardCheck {
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

function NotificationsList({
  notifications,
  loading,
  onClear,
  onNavigate,
}: {
  readonly notifications: readonly NotificationCenterItem[]
  readonly loading: boolean
  readonly onClear: () => void
  readonly onNavigate: (item: NotificationCenterItem) => void
}) {
  return (
    <>
      <div className="max-h-[60vh] overflow-y-auto">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Loading notifications...
          </div>
        ) : notifications.length > 0 ? (
          notifications.map((item) => {
            const Icon = iconFor(item)
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => onNavigate(item)}
                className="hover:bg-muted/50 flex gap-3 border-b px-4 py-3 transition-colors last:border-0"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">
                      {item.title}
                    </p>
                    <span className="text-[11px] font-medium text-primary">
                      Open
                    </span>
                  </div>
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                    {item.body}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{relativeTime(item.createdAt)}</span>
                    {!item.readAt && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        New
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            )
          })
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No unread notifications.
          </div>
        )}
      </div>
      <div className="border-t px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-full text-xs"
          disabled={notifications.length === 0}
          onClick={onClear}
        >
          Mark all as read
        </Button>
      </div>
    </>
  )
}

export function NotificationsPopover() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] =
    useState<readonly NotificationCenterItem[]>([])
  const unreadCount = useMemo(
    () => notifications.filter((item) => item.readAt === null).length,
    [notifications]
  )
  const hasUnread = unreadCount > 0

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      const result = await getNotificationCenter()
      if (!cancelled && result.success) {
        setNotifications(result.data.items)
      }
      if (!cancelled) {
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function clearAll(): Promise<void> {
    const result = await markAllNotificationsRead()
    if (result.success) {
      setNotifications((items) =>
        items.map((item) => ({
          ...item,
          readAt: item.readAt ?? new Date().toISOString(),
        }))
      )
    }
  }

  async function navigate(item: NotificationCenterItem): Promise<void> {
    setOpen(false)
    if (item.readAt) return
    setNotifications((items) =>
      items.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, readAt: new Date().toISOString() }
          : candidate
      )
    )
    await markNotificationRead(item.id)
  }

  const trigger = (
    <Button variant="ghost" size="icon" className="relative size-8">
      <BadgeIndicator dot={hasUnread}>
        <IconBell className="size-4" />
      </BadgeIndicator>
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Button>
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="p-0" showClose={false}>
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="text-base font-medium">
              Notifications
            </SheetTitle>
          </SheetHeader>
          <NotificationsList
            notifications={notifications}
            loading={loading}
            onClear={clearAll}
            onNavigate={navigate}
          />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Notifications</p>
        </div>
        <NotificationsList
          notifications={notifications}
          loading={loading}
          onClear={clearAll}
          onNavigate={navigate}
        />
      </PopoverContent>
    </Popover>
  )
}
