"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { useTheme } from "@/components/theme-provider"
import {
  IconLogout,
  IconCode,
  IconMenu2,
  IconMessageCircle,
  IconMoon,
  IconSearch,
  IconSparkles,
  IconSun,
  IconUserCircle,
  IconVideo,
} from "@tabler/icons-react"

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
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { NotificationsPopover } from "@/components/notifications-popover"
import { useCommandMenu } from "@/components/command-menu-provider"
import { useAgentOptional } from "@/components/agent/chat-provider"
import { AccountModal } from "@/components/account-modal"
import { useConversationPanelOptional } from "@/components/conversations/conversation-panel-provider"
import { getInitials } from "@/lib/utils"
import type { SidebarUser } from "@/lib/auth"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { QuickAddMenu } from "@/components/quick-add-menu"
import type { QuickAddAction } from "@/lib/quick-add"

const OFFICE_TALK_MEETING_HREF =
  "/dashboard/conversations/voice-office-talk-0a72accb-1cd1-4d2d-86d7-88b0e26a8899/meeting"
const OFFICE_TALK_WINDOW_NAME = "compass-office-talk"

export function openOfficeTalkWindow(): void {
  const availableWidth = window.screen.availWidth
  const availableHeight = window.screen.availHeight
  const width = Math.min(1180, Math.max(720, availableWidth - 80))
  const height = Math.min(760, Math.max(600, availableHeight - 80))
  const left = Math.max(0, Math.round((availableWidth - width) / 2))
  const top = Math.max(0, Math.round((availableHeight - height) / 2))
  const features = [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "resizable=yes",
    "scrollbars=yes",
  ].join(",")

  const meetingWindow = window.open(
    OFFICE_TALK_MEETING_HREF,
    OFFICE_TALK_WINDOW_NAME,
    features
  )
  if (meetingWindow) {
    meetingWindow.focus()
    return
  }

  window.open(OFFICE_TALK_MEETING_HREF, "_blank", "noopener,noreferrer")
}

export function SiteHeader({
  user,
  canUseAskCompass,
  canUseOfficeTalk,
  canUseDirectMessages,
  quickAddActions,
}: {
  readonly user: SidebarUser | null
  readonly canUseAskCompass: boolean
  readonly canUseOfficeTalk: boolean
  readonly canUseDirectMessages: boolean
  readonly quickAddActions: readonly QuickAddAction[]
}) {
  const { theme, setTheme } = useTheme()
  const { open: openCommand, openWithQuery } = useCommandMenu()
  const [headerQuery, setHeaderQuery] = React.useState("")
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const agentContext = useAgentOptional()
  const conversationPanel = useConversationPanelOptional()
  const [accountOpen, setAccountOpen] = React.useState(false)
  const [isLoggingOut, startLogoutTransition] = React.useTransition()
  const { toggleSidebar } = useSidebar()
  const pathname = usePathname()
  const {
    canUseDeveloperMode,
    developerModeEnabled,
    setDeveloperModeEnabled,
  } = useDeveloperMode()

  if (pathname.startsWith("/dashboard/field")) return null

  const initials = user ? getInitials(user.name) : "?"

  function handleLogout(): void {
    startLogoutTransition(async () => {
      await logout()
    })
  }

  return (
    <header className="sticky top-0 z-40 flex shrink-0 items-center border-b border-border/40 bg-background/80 backdrop-blur-sm">
      {/* mobile header: single unified pill */}
      <div className="flex h-14 w-full items-center px-3 md:hidden">
        <div className="flex h-11 w-full items-center gap-1 rounded-lg bg-muted/50 px-2.5 sm:gap-2">
          <button
            type="button"
            className="flex size-10 shrink-0 items-center justify-center rounded-full -ml-0.5 hover:bg-background/60"
            onClick={() => {
              toggleSidebar()
            }}
            aria-label="Open menu"
          >
            <IconMenu2 className="size-5 text-muted-foreground" />
          </button>
          <button
            type="button"
            className="flex h-9 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md px-2 hover:bg-background/60"
            onClick={openCommand}
            aria-label={
              canUseAskCompass
                ? "Ask Jarvis or search Compass"
                : "Search Compass"
            }
          >
            <IconSearch className="size-4 text-muted-foreground shrink-0" />
            <span className="min-w-0 truncate whitespace-nowrap text-left text-sm text-muted-foreground">
              {canUseAskCompass ? "Ask Jarvis or search..." : "Search Compass..."}
            </span>
          </button>
          <button
            type="button"
            className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground"
            onClick={() => {
              setTheme(theme === "dark" ? "light" : "dark")
            }}
            aria-label="Toggle theme"
          >
            <IconSun className="size-4 hidden dark:block" />
            <IconMoon className="size-4 block dark:hidden" />
          </button>
          <NotificationsPopover />
          <QuickAddMenu actions={quickAddActions} />
          {canUseOfficeTalk && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={openOfficeTalkWindow}
              aria-label="Open Office Talk"
              title="Office Talk"
            >
              <IconVideo className="size-4" />
            </Button>
          )}
          {canUseDirectMessages && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => conversationPanel?.openDirectMessages()}
              aria-label="Direct message a team member"
              title="Direct message"
            >
              <IconMessageCircle className="size-4" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => e.stopPropagation()}
              >
                <Avatar className="size-8 grayscale">
                  {user?.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-medium">{user?.name ?? "User"}</p>
                <p className="text-muted-foreground text-xs">{user?.email ?? ""}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setAccountOpen(true)}>
                <IconUserCircle />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
                <IconSun className="size-4 hidden dark:block" />
                <IconMoon className="size-4 block dark:hidden" />
                <span>Toggle theme</span>
              </DropdownMenuItem>
              {canUseDeveloperMode && (
                <DropdownMenuItem
                  onSelect={() =>
                    setDeveloperModeEnabled(!developerModeEnabled)
                  }
                >
                  <IconCode />
                  {developerModeEnabled
                    ? "Turn off developer mode"
                    : "Turn on developer mode"}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={isLoggingOut} onSelect={handleLogout}>
                <IconLogout />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* desktop header: three-column grid for true center search */}
      <div className="hidden h-12 w-full grid-cols-[1fr_minmax(0,28rem)_1fr] items-center px-4 md:grid">
        <div className="flex items-center gap-1">
          <SidebarTrigger className="-ml-1" />
        </div>

        <div className="relative justify-self-center w-full">
          <IconSearch className="text-muted-foreground/60 absolute top-1/2 left-3 size-4 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={headerQuery}
            onChange={(e) => setHeaderQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                const q = headerQuery.trim()
                if (q) {
                  openWithQuery(q)
                } else {
                  openCommand()
                }
                setHeaderQuery("")
                searchInputRef.current?.blur()
              }
            }}
            placeholder={
              canUseAskCompass
                ? "Ask Jarvis or search Compass..."
                : "Search Compass..."
            }
            className="flex h-8 w-full items-center rounded-md border border-border/50 bg-muted/30 pl-9 pr-16 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-muted/50 focus:bg-muted/50 focus:border-border"
          />
          <kbd
            className="text-muted-foreground/50 pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 hidden sm:inline-flex h-5 items-center gap-0.5 rounded-md border border-border/40 bg-background/50 px-1.5 font-mono text-[10px]"
          >
            <span>&#x2318;</span>K
          </kbd>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-0.5">
          {canUseDeveloperMode && (
            <Button
              variant={developerModeEnabled ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs print:hidden"
              onClick={() =>
                setDeveloperModeEnabled(!developerModeEnabled)
              }
              aria-pressed={developerModeEnabled}
              aria-label="Toggle developer mode"
              title={developerModeEnabled ? "Developer mode on" : "Developer mode off"}
            >
              <IconCode className="size-4" />
              <span className="hidden xl:inline">Developer</span>
            </Button>
          )}
          <NotificationsPopover />
          <QuickAddMenu actions={quickAddActions} />
          {canUseOfficeTalk && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={openOfficeTalkWindow}
              aria-label="Open Office Talk"
              title="Office Talk"
            >
              <IconVideo className="size-4" />
            </Button>
          )}
          {canUseDirectMessages && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => conversationPanel?.openDirectMessages()}
              aria-label="Direct message a team member"
              title="Direct message"
            >
              <IconMessageCircle className="size-4" />
            </Button>
          )}
          {canUseAskCompass && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => agentContext?.toggle()}
              aria-label="Toggle Jarvis"
            >
              <IconSparkles className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            <IconSun className="size-4 hidden dark:block" />
            <IconMoon className="size-4 block dark:hidden" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-0.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="size-6 grayscale">
                  {user?.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                  <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-medium">{user?.name ?? "User"}</p>
                <p className="text-muted-foreground text-xs">{user?.email ?? ""}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setAccountOpen(true)}>
                <IconUserCircle />
                Account
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={isLoggingOut} onSelect={handleLogout}>
                <IconLogout />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AccountModal open={accountOpen} onOpenChange={setAccountOpen} user={user} />
    </header>
  )
}
