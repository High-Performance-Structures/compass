"use client"

import * as React from "react"
import { IconMessageCircle, IconMoon, IconSun } from "@tabler/icons-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { NotificationsPopover } from "@/components/notifications-popover"
import { ProjectAudienceNotificationSettings } from "@/components/projects/project-audience-notification-settings"
import { ProjectAudienceDirectMessageDialog } from "@/components/projects/project-audience-direct-message-dialog"
import { useTheme } from "@/components/theme-provider"
import { getInitials } from "@/lib/utils"
import type { ProjectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"

type AudienceViewer = {
  readonly name: string
  readonly avatarUrl: string | null
}

export function ProjectAudienceHeaderControls({
  viewer,
  messageShortcut,
}: {
  readonly viewer: AudienceViewer
  readonly messageShortcut: ProjectAudienceMessageShortcut | null
}): React.ReactElement {
  const { theme, setTheme } = useTheme()
  const [messageOpen, setMessageOpen] = React.useState(false)

  return (
    <div className="flex shrink-0 items-center justify-end gap-0.5">
      {messageShortcut && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => setMessageOpen(true)}
            aria-label="Message a project team member"
            title="Direct message"
          >
            <IconMessageCircle className="size-4" />
          </Button>
          <ProjectAudienceDirectMessageDialog
            open={messageOpen}
            onOpenChange={setMessageOpen}
            shortcut={messageShortcut}
          />
        </>
      )}
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
