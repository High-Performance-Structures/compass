"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import {
  IconLogout,
  IconMenu2,
  IconMoon,
  IconSearch,
  IconMessageCircle,
  IconSun,
  IconUserCircle,
  IconSettings,
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
import { useFeedback } from "@/components/feedback-widget"
import { useSettings } from "@/components/settings-provider"
import { AccountModal } from "@/components/account-modal"
import { getInitials } from "@/lib/utils"
import type { SidebarUser } from "@/lib/auth"

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="size-9" /> // placeholder
  }

  const isDark = theme === "dark"

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-9 rounded-full"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      {isDark ? (
        <IconMoon className="size-4" />
      ) : (
        <IconSun className="size-4" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}

function UserDropdown({
  user,
  initials,
  onAccountOpen,
  onSettingsOpen,
  onLogout,
}: {
  user: SidebarUser | null
  initials: string
  onAccountOpen: () => void
  onSettingsOpen: () => void
  onLogout: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="ml-0.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar className="size-6">
            {user?.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
            <AvatarFallback className="text-[10px] bg-gradient-to-br from-primary to-accent text-primary-foreground font-bold tracking-tight shadow-sm">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium">{user?.name ?? "User"}</p>
          <p className="text-muted-foreground text-xs">{user?.email ?? ""}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAccountOpen}>
          <IconUserCircle className="size-4 mr-2" />
          Account
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSettingsOpen}>
          <IconSettings className="size-4 mr-2" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <IconLogout className="size-4 mr-2" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SiteHeader({
  user,
}: {
  readonly user: SidebarUser | null
}) {
  const { open: openCommand, openWithQuery } = useCommandMenu()
  const [headerQuery, setHeaderQuery] = React.useState("")
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const { open: openFeedback } = useFeedback()
  const { open: openSettings } = useSettings()
  const [accountOpen, setAccountOpen] = React.useState(false)
  const { toggleSidebar } = useSidebar()

  const initials = user ? getInitials(user.name) : "?"

  async function handleLogout() {
    await logout()
  }

  return (
    <header className="sticky top-0 z-40 flex shrink-0 items-center border-b border-border/40 bg-background/80 backdrop-blur-sm">
      {/* mobile header */}
      <div className="flex h-14 w-full items-center justify-between px-3 md:hidden">
        <button
          className="flex size-9 items-center justify-center rounded-full hover:bg-muted/50"
          onClick={toggleSidebar}
          aria-label="Open menu"
        >
          <IconMenu2 className="size-5 text-muted-foreground" />
        </button>

        <div
          className="flex h-10 flex-1 max-w-xs mx-2 items-center gap-2 rounded-full bg-muted/50 px-3 cursor-pointer"
          onClick={openCommand}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") openCommand()
          }}
        >
          <IconSearch className="size-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground text-sm flex-1">
            Search...
          </span>
        </div>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <NotificationsPopover />
          <UserDropdown
            user={user}
            initials={initials}
            onAccountOpen={() => setAccountOpen(true)}
            onSettingsOpen={openSettings}
            onLogout={handleLogout}
          />
        </div>
      </div>

      {/* desktop header: three-column grid for true center search */}
      <div className="hidden h-12 w-full grid-cols-[1fr_minmax(0,28rem)_1fr] items-center px-4 md:grid">
        <div className="flex items-center gap-1">
          <SidebarTrigger className="-ml-1" />
          <button
            onClick={openFeedback}
            className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-primary-foreground text-xs font-medium shadow-sm hover:bg-primary/90 active:scale-95 transition-all"
            aria-label="Send feedback"
          >
            <IconMessageCircle className="size-3.5" />
            Feedback
          </button>
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
            placeholder="Search..."
            className="flex h-8 w-full items-center rounded-full border border-border/50 bg-muted/30 pl-9 pr-16 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-muted/50 focus:bg-muted/50 focus:border-border"
          />
          <kbd
            className="text-muted-foreground/50 pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 hidden sm:inline-flex h-5 items-center gap-0.5 rounded-md border border-border/40 bg-background/50 px-1.5 font-mono text-[10px]"
          >
            <span>&#x2318;</span>K
          </kbd>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-0.5">
          <NotificationsPopover />
          <ThemeToggle />
          <UserDropdown
            user={user}
            initials={initials}
            onAccountOpen={() => setAccountOpen(true)}
            onSettingsOpen={openSettings}
            onLogout={handleLogout}
          />
        </div>
      </div>

      <AccountModal open={accountOpen} onOpenChange={setAccountOpen} user={user} />
    </header>
  )
}
