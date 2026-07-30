"use client"

import * as React from "react"
import { IconMoon, IconSun } from "@tabler/icons-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { NotificationsPopover } from "@/components/notifications-popover"
import { ProjectAudienceNotificationSettings } from "@/components/projects/project-audience-notification-settings"
import { useTheme } from "@/components/theme-provider"
import { getInitials } from "@/lib/utils"

type AudienceViewer = {
  readonly name: string
  readonly avatarUrl: string | null
}

export function ProjectAudienceHeaderControls({
  viewer,
}: {
  readonly viewer: AudienceViewer
}): React.ReactElement {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex shrink-0 items-center justify-end gap-0.5">
      <NotificationsPopover />
      <ProjectAudienceNotificationSettings
        compact
        triggerIcon="settings"
        className="size-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        aria-label="Toggle theme"
        title="Toggle theme"
      >
        <IconSun className="hidden size-4 dark:block" />
        <IconMoon className="block size-4 dark:hidden" />
      </Button>
      <Avatar className="ml-0.5 size-6 grayscale">
        {viewer.avatarUrl && (
          <AvatarImage src={viewer.avatarUrl} alt={viewer.name} />
        )}
        <AvatarFallback className="text-[10px]">
          {getInitials(viewer.name)}
        </AvatarFallback>
      </Avatar>
    </div>
  )
}
