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

const notifications = [
  {
    icon: IconClipboardCheck,
    title: "Task assigned",
    description: "You've been assigned to \"Update homepage layout\"",
    time: "2m ago",
  },
  {
    icon: IconMessageCircle,
    title: "New comment",
    description: "Sarah left a comment on the brand assets file",
    time: "15m ago",
  },
  {
    icon: IconAlertCircle,
    title: "Deadline approaching",
    description: "\"Q1 Report\" is due tomorrow",
    time: "1h ago",
  },
  {
    icon: IconClock,
    title: "Status changed",
    description: "\"API Integration\" moved to In Review",
    time: "3h ago",
  },
]

function NotificationsList() {
  return (
    <>
      <div className="max-h-[60vh] overflow-y-auto">
        {notifications.map((item, index) => (
          <div
            key={`${item.title}-${index}`}
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
        <Button variant="ghost" size="sm" className="h-9 w-full text-xs">
          Mark all as read
        </Button>
      </div>
    </>
  )
}

export function NotificationsPopover() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  const trigger = (
    <Button variant="ghost" size="icon" className="relative size-8">
      <BadgeIndicator dot>
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
          <NotificationsList />
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
        <NotificationsList />
      </PopoverContent>
    </Popover>
  )
}
