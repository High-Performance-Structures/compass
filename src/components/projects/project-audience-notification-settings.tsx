"use client"

import * as React from "react"
import { IconBell } from "@tabler/icons-react"

import { PreferencesTab } from "@/components/settings/preferences-tab"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export function ProjectAudienceNotificationSettings({
  compact = false,
  className,
}: {
  readonly compact?: boolean
  readonly className?: string
}): React.ReactElement {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          className={cn(!compact && "w-full justify-start", className)}
          aria-label={compact ? "Notification settings" : undefined}
        >
          <IconBell className="size-4" />
          {!compact && "Notifications"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>Notification settings</DialogTitle>
          <DialogDescription>
            Choose how Compass should alert you about project activity and
            direct mentions.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(90vh-7rem)]">
          <div className="p-6">
            <PreferencesTab />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
