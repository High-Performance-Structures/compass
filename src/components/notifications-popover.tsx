"use client"

import { useState, useEffect, useCallback } from "react"
import {
  IconBell,
  IconMessageCircle,
  IconAlertCircle,
  IconClipboardCheck,
  IconClock,
  IconInfoCircle,
  IconCheck,
  IconX,
  IconLoader2,
  IconHistory,
  IconChevronUp,
  type Icon,
} from "@tabler/icons-react"
import { formatDistanceToNow } from "date-fns"

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
import {
  getNotifications,
  getOldNotifications,
  clearAllNotifications,
  clearNotification,
} from "@/app/actions/notifications"
import type { Notification } from "@/db/schema"

const iconMap: Record<string, Icon> = {
  "clipboard-check": IconClipboardCheck,
  "message-circle": IconMessageCircle,
  "alert-circle": IconAlertCircle,
  clock: IconClock,
  "info-circle": IconInfoCircle,
  check: IconCheck,
}

function getRelativeTime(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true })
  } catch {
    return ""
  }
}

function NotificationItem({
  notification,
  onClear,
}: {
  notification: Notification
  onClear?: () => void
}) {
  const IconComponent = iconMap[notification.iconName ?? ""] ?? IconInfoCircle

  return (
    <div className="hover:bg-muted/50 flex gap-3 border-b px-4 py-3 last:border-0">
      <IconComponent className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{notification.title}</p>
        {notification.description && (
          <p className="text-muted-foreground line-clamp-2 break-words text-xs">
            {notification.description}
          </p>
        )}
        <p className="text-muted-foreground mt-0.5 text-xs">
          {getRelativeTime(notification.createdAt)}
        </p>
      </div>
      {onClear && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          onClick={onClear}
        >
          <IconX className="size-3" />
        </Button>
      )}
    </div>
  )
}

function NotificationsList({
  notifications,
  isLoading,
  onClearAll,
  onClearOne,
  onShowOld,
  showingOld,
}: {
  notifications: Notification[]
  isLoading: boolean
  onClearAll: () => void
  onClearOne: (id: string) => void
  onShowOld: () => void
  showingOld: boolean
}) {
  const hasNotifications = notifications.length > 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <IconLoader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    )
  }

  return (
    <>
      <div className="max-h-[60vh] overflow-y-auto">
        {hasNotifications ? (
          notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onClear={showingOld ? undefined : () => onClearOne(notification.id)}
            />
          ))
        ) : (
          <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-8">
            <IconBell className="size-8 opacity-50" />
            <p className="text-sm">
              {showingOld ? "No old notifications" : "No new notifications"}
            </p>
          </div>
        )}
      </div>
      <div className="border-t px-4 py-2">
        {showingOld ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-full text-xs"
            onClick={onShowOld}
          >
            <IconChevronUp className="mr-1 size-3" />
            Back to new notifications
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 flex-1 text-xs"
              onClick={onShowOld}
            >
              <IconHistory className="mr-1 size-3" />
              View old
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 flex-1 text-xs"
              onClick={onClearAll}
              disabled={!hasNotifications}
            >
              Clear all
            </Button>
          </div>
        )}
      </div>
    </>
  )
}

export function NotificationsPopover() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showingOld, setShowingOld] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchNotifications = useCallback(async (old = false) => {
    setIsLoading(true)
    const result = old
      ? await getOldNotifications()
      : await getNotifications()
    setIsLoading(false)

    if (result.success) {
      setNotifications([...result.notifications])
      if (!old) {
        setUnreadCount(result.notifications.length)
      }
    }
  }, [])

  useEffect(() => {
    if (open) {
      setShowingOld(false)
      fetchNotifications(false)
    }
  }, [open, fetchNotifications])

  const handleClearAll = async () => {
    const result = await clearAllNotifications()
    if (result.success) {
      setNotifications([])
      setUnreadCount(0)
    }
  }

  const handleClearOne = async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    setUnreadCount((prev) => Math.max(0, prev - 1))
    await clearNotification(id)
  }

  const handleShowOld = () => {
    if (showingOld) {
      setShowingOld(false)
      fetchNotifications(false)
    } else {
      setShowingOld(true)
      fetchNotifications(true)
    }
  }

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      className="relative size-8 min-h-9 min-w-9"
    >
      <BadgeIndicator dot={unreadCount > 0}>
        <IconBell className="size-4" />
      </BadgeIndicator>
    </Button>
  )

  const listProps = {
    notifications,
    isLoading,
    onClearAll: handleClearAll,
    onClearOne: handleClearOne,
    onShowOld: handleShowOld,
    showingOld,
  }

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="p-0" showClose={false}>
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="text-base font-medium">
              {showingOld ? "Old Notifications" : "Notifications"}
            </SheetTitle>
          </SheetHeader>
          <NotificationsList {...listProps} />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">
            {showingOld ? "Old Notifications" : "Notifications"}
          </p>
        </div>
        <NotificationsList {...listProps} />
      </PopoverContent>
    </Popover>
  )
}

export function useNotificationsSheet() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showingOld, setShowingOld] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchNotifications = useCallback(async (old = false) => {
    setIsLoading(true)
    const result = old
      ? await getOldNotifications()
      : await getNotifications()
    setIsLoading(false)

    if (result.success) {
      setNotifications([...result.notifications])
      if (!old) {
        setUnreadCount(result.notifications.length)
      }
    }
  }, [])

  useEffect(() => {
    if (open) {
      setShowingOld(false)
      fetchNotifications(false)
    }
  }, [open, fetchNotifications])

  const handleClearAll = async () => {
    const result = await clearAllNotifications()
    if (result.success) {
      setNotifications([])
      setUnreadCount(0)
    }
  }

  const handleClearOne = async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    setUnreadCount((prev) => Math.max(0, prev - 1))
    await clearNotification(id)
  }

  const handleShowOld = () => {
    if (showingOld) {
      setShowingOld(false)
      fetchNotifications(false)
    } else {
      setShowingOld(true)
      fetchNotifications(true)
    }
  }

  const sheet = (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="bottom" className="p-0" showClose={false}>
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="text-base font-medium">
            {showingOld ? "Old Notifications" : "Notifications"}
          </SheetTitle>
        </SheetHeader>
        <NotificationsList
          notifications={notifications}
          isLoading={isLoading}
          onClearAll={handleClearAll}
          onClearOne={handleClearOne}
          onShowOld={handleShowOld}
          showingOld={showingOld}
        />
      </SheetContent>
    </Sheet>
  )

  return {
    openNotifications: () => setOpen(true),
    unreadCount,
    sheet,
  }
}
