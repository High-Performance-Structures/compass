"use client"

import * as React from "react"
import { IconBell, IconSettings } from "@tabler/icons-react"

import { PreferencesTab } from "@/components/settings/preferences-tab"
import { Button } from "@/components/ui/button"
import { RecordDrawer } from "@/components/record-drawer"
import { cn } from "@/lib/utils"

export function ProjectAudienceNotificationSettings({
  compact = false,
  triggerIcon = "bell",
  className,
  triggerLabel = "Notification settings",
}: {
  readonly compact?: boolean
  readonly triggerIcon?: "bell" | "settings"
  readonly triggerLabel?: string
  readonly className?: string
}): React.ReactElement {
  const TriggerIcon = triggerIcon === "settings" ? IconSettings : IconBell

  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size={compact ? "icon" : "sm"}
        className={cn(!compact && "w-full justify-start", className)}
        aria-label={compact ? "Notification settings" : undefined}
        title={compact ? "Notification settings" : undefined}
        onClick={() => setOpen(true)}
      >
        <TriggerIcon className="size-4" />
        {!compact && triggerLabel}
      </Button>
      <RecordDrawer
        open={open}
        onOpenChange={setOpen}
        title="Notification settings"
        description="Choose how Compass should alert you about project activity and direct mentions."
      >
        <PreferencesTab />
      </RecordDrawer>
    </>
  )
}
