"use client"

import { useState, useEffect } from "react"
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

const defaultNotifications = [
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

function NotificationsList({
  items,
  onClear,
}: {
  items: typeof defaultNotifications
  onClear: () => void
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <IconBell className="text-muted-foreground/30 mb-2 size-8" />
        <p className="text-sm font-medium">No notifications</p>
        <p className="text-muted-foreground text-xs">
          You&apos;re all caught up!
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="max-h-[60vh] overflow-y-auto">
        {items.map((item, index) => (
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
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-full text-xs"
          onClick={onClear}
        >
          Clear notifications
        </Button>
      </div>
    </>
  )
}

export function NotificationsPopover() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(defaultNotifications)

  // Load from local storage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("compass-notifications")
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed) && parsed.length === 0) {
            setItems([])
          }
        } catch (e) {
          console.error("Failed to parse notifications", e)
        }
      }
    }
  }, [])

  const handleClear = () => {
    setItems([])
    localStorage.setItem("compass-notifications", "[]")
  }

  const trigger = (
    <Button variant="ghost" size="icon" className="relative size-8">
      <BadgeIndicator dot={items.length > 0}>
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
          <NotificationsList items={items} onClear={handleClear} />
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
        <NotificationsList items={items} onClear={handleClear} />
      </PopoverContent>
    </Popover>
  )
}
