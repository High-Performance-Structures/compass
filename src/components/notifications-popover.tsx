"use client"

import { useState } from "react"
import {
  IconBell,
  IconMessageCircle,
  IconAlertCircle,
  IconClipboardCheck,
  IconClock,
} from "@tabler/icons-react"

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

const initialNotifications = [
  {
    id: "1",
    icon: IconClipboardCheck,
    title: "Task assigned",
    description: "You've been assigned to \"Update homepage layout\"",
    time: "2m ago",
  },
  {
    id: "2",
    icon: IconMessageCircle,
    title: "New comment",
    description: "Sarah left a comment on the brand assets file",
    time: "15m ago",
  },
  {
    id: "3",
    icon: IconAlertCircle,
    title: "Deadline approaching",
    description: "\"Q1 Report\" is due tomorrow",
    time: "1h ago",
  },
  {
    id: "4",
    icon: IconClock,
    title: "Status changed",
    description: "\"API Integration\" moved to In Review",
    time: "3h ago",
  },
]

interface NotificationsListProps {
  readonly notifications: typeof initialNotifications
  readonly onMarkAllRead: () => void
}

function NotificationsList({ notifications, onMarkAllRead }: NotificationsListProps) {
  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <IconBell className="size-8 mb-2 opacity-50" />
        <p className="text-sm">No new notifications</p>
      </div>
    )
  }

  return (
    <>
      <div className="max-h-[60vh] overflow-y-auto">
        {notifications.map((item) => (
          <div
            key={item.id}
            className="hover:bg-muted/50 flex gap-3 border-b px-4 py-3 last:border-0"
          >
            <item.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-muted-foreground line-clamp-2 break-words text-xs">
                {item.description}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {item.time}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-full text-xs"
          onClick={onMarkAllRead}
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
  const [notifications, setNotifications] = useState(initialNotifications)
  const hasUnread = notifications.length > 0

  const handleMarkAllRead = () => {
    setNotifications([])
    setOpen(false)
  }

  const trigger = (
    <Button variant="ghost" size="icon" className="relative size-8">
      {hasUnread && (
        <BadgeIndicator dot>
          <IconBell className="size-4" />
        </BadgeIndicator>
      )}
      {!hasUnread && <IconBell className="size-4" />}
    </Button>
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="p-0" showClose={false}>
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="text-base font-medium">Notifications</SheetTitle>
          </SheetHeader>
          <NotificationsList
            notifications={notifications}
            onMarkAllRead={handleMarkAllRead}
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
          onMarkAllRead={handleMarkAllRead}
        />
      </PopoverContent>
    </Popover>
  )
}
