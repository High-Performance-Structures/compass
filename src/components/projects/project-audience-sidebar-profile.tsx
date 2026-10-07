"use client"

import * as React from "react"
import {
  IconCheck,
  IconMoon,
  IconPalette,
  IconSun,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useCompassTheme, useTheme } from "@/components/theme-provider"
import { THEME_PRESETS } from "@/lib/theme/presets"
import { cn } from "@/lib/utils"
import { SidebarDeskPhoto } from "@/components/nav-user"
import { SidebarWorkspaceDrawer } from "@/components/sidebar-workspace-drawer"
import { ProjectAudienceNotificationSettings } from "@/components/projects/project-audience-notification-settings"

type AudienceViewer = {
  readonly name: string
  readonly email: string
  readonly avatarUrl: string | null
  readonly sidebarPhotoUrl: string | null
}

export function ProjectAudienceSidebarProfile({
  viewer,
}: {
  readonly viewer: AudienceViewer
}): React.ReactElement {
  const { theme, setTheme } = useTheme()
  const { activeThemeId, setVisualTheme } = useCompassTheme()
  const photoUser = React.useMemo(() => ({
    name: viewer.name,
    email: viewer.email,
    avatar: viewer.avatarUrl,
    sidebarDeskPhoto: viewer.sidebarPhotoUrl,
  }), [viewer.name, viewer.email, viewer.avatarUrl, viewer.sidebarPhotoUrl])
  return (
    <SidebarWorkspaceDrawer
      preferenceKey={`compass-sidebar-drawer-pinned:${viewer.email}`}
      collapsed={false}
      onExpand={null}
      communicationDock={null}
    >
      <div className="flex items-center gap-2 px-1">
        <SidebarDeskPhoto user={photoUser} />
        <div className="min-w-0 flex-1">
          <ProjectAudienceNotificationSettings triggerLabel="Notifications" className="h-6 px-1 text-xs [&>svg]:size-3.5" />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-full justify-start px-1 text-xs [&>svg]:size-3.5">
                <IconPalette className="size-4" />
                Appearance
              </Button>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" className="w-72">
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium">Appearance</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Make this Compass workspace feel like yours.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={theme === "light" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme("light")}
                  >
                    <IconSun className="size-4" />
                    Light
                  </Button>
                  <Button
                    variant={theme === "dark" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme("dark")}
                  >
                    <IconMoon className="size-4" />
                    Dark
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {THEME_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => void setVisualTheme(preset.id)}
                      className={cn(
                        "flex min-h-10 items-center justify-between border px-3 py-2 text-left text-xs transition-colors hover:bg-accent",
                        activeThemeId === preset.id && "border-primary"
                      )}
                    >
                      <span>{preset.name}</span>
                      {activeThemeId === preset.id && (
                        <IconCheck className="size-3.5 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </SidebarWorkspaceDrawer>
  )
}
