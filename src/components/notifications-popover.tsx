"use client"

import { useState } from "react"
import Link from "next/link"
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

type NotificationItem = {
  readonly icon: typeof IconClipboardCheck
  readonly title: string
  readonly description: string
  readonly time: string
  readonly href: string
}

const initialNotifications: readonly NotificationItem[] = [
  {
    icon: IconClipboardCheck,
    title: "Schedule item assigned",
    description: "Foundation prep and ICF coordination is ready to review.",
    time: "2m ago",
    href: "/dashboard/schedule",
  },
  {
    icon: IconMessageCircle,
    title: "Project message",
    description: "A subcontractor channel is waiting for its first message.",
    time: "15m ago",
    href: "/dashboard/conversations",
  },
  {
    icon: IconAlertCircle,
    title: "RFI due soon",
    description: "Anchor bolt layout confirmation is due May 17.",
    time: "1h ago",
    href: "/dashboard/projects",
  },
  {
    icon: IconClock,
    title: "Photos awaiting review",
    description: "Buildertrend import photos are staged for visibility review.",
    time: "3h ago",
    href: "/dashboard/projects",
  },
]

function NotificationsList({
  notifications,
  onClear,
  onNavigate,
}: {
  readonly notifications: readonly NotificationItem[]
  readonly onClear: () => void
  readonly onNavigate: () => void
}) {
  return (
    <>
      <div className="max-h-[60vh] overflow-y-auto">
        {notifications.length > 0 ? (
          notifications.map((item, index) => (
            <Link
              key={`${item.title}-${index}`}
              href={item.href}
              onClick={onNavigate}
              className="hover:bg-muted/50 flex gap-3 border-b px-4 py-3 transition-colors last:border-0"
            >
              <item.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.title}</p>
                  <span className="text-[11px] font-medium text-primary">
                    Open
                  </span>
                </div>
                <p className="text-muted-foreground line-clamp-2 break-words text-xs">
                  {item.description}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {item.time}
                </p>
              </div>
            </Link>
          ))
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
  const [notifications, setNotifications] =
    useState<readonly NotificationItem[]>(initialNotifications)
  const hasUnread = notifications.length > 0

  const trigger = (
    <Button variant="ghost" size="icon" className="relative size-8">
      <BadgeIndicator dot={hasUnread}>
        <IconBell className="size-4" />
      </BadgeIndicator>
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
            onClear={() => setNotifications([])}
            onNavigate={() => setOpen(false)}
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
          onClear={() => setNotifications([])}
          onNavigate={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
