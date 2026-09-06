"use client"

import * as React from "react"
import {
  IconLogout,
  IconMessageCircle,
  IconMoon,
  IconSun,
} from "@tabler/icons-react"

import { QuickAddMenu } from "@/components/quick-add-menu"
import { HelpDrawer } from "@/components/help/help-drawer"
import { useCanViewHelp } from "@/components/help/help-ui-provider"

import { logout } from "@/app/actions/profile"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NotificationsPopover } from "@/components/notifications-popover"
import { ProjectAudienceNotificationSettings } from "@/components/projects/project-audience-notification-settings"
import { ProjectAudienceDirectMessageDialog } from "@/components/projects/project-audience-direct-message-dialog"
import { useTheme } from "@/components/theme-provider"
import { getInitials } from "@/lib/utils"
import type { ProjectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"

type AudienceViewer = {
  readonly name: string
  readonly email: string
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
  const canViewHelp = useCanViewHelp()
  const [messageOpen, setMessageOpen] = React.useState(false)
  const [isLoggingOut, startLogoutTransition] = React.useTransition()

  function handleLogout(): void {
    startLogoutTransition(async () => {
      await logout()
    })
  }

  return (
    <div className="flex shrink-0 items-center justify-end gap-0.5">
      <QuickAddMenu />
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
      {canViewHelp ? (
        <HelpDrawer
          triggerClassName="size-7 shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        />
      ) : null}
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="ml-0.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open account menu"
            title="Account menu"
          >
            <Avatar className="size-6 grayscale">
              {viewer.avatarUrl && (
                <AvatarImage src={viewer.avatarUrl} alt={viewer.name} />
              )}
              <AvatarFallback className="text-[10px]">
                {getInitials(viewer.name)}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-sm font-medium">{viewer.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {viewer.email}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={isLoggingOut} onSelect={handleLogout}>
            <IconLogout />
            {isLoggingOut ? "Logging out..." : "Log out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
