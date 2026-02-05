"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import {
  IconLogout,
  IconMenu2,
  IconMoon,
  IconSearch,
  IconSun,
  IconUserCircle,
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
import { AccountModal } from "@/components/account-modal"
import { getInitials } from "@/lib/utils"
import type { SidebarUser } from "@/lib/auth"

export function SiteHeader({
  user,
}: {
  readonly user: SidebarUser | null
}) {
  const { theme, setTheme } = useTheme()
  const { open: openCommand } = useCommandMenu()
  const { open: openFeedback } = useFeedback()
  const [accountOpen, setAccountOpen] = React.useState(false)
  const { toggleSidebar } = useSidebar()

  const initials = user ? getInitials(user.name) : "?"

  async function handleLogout() {
    await logout()
  }

  return (
    <header className="sticky top-0 z-40 flex shrink-0 items-center bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* mobile header: single unified pill */}
      <div className="flex h-14 w-full items-center px-3 md:hidden">
        <div
          className="flex h-11 w-full items-center gap-2 rounded-full bg-muted/50 px-2.5 cursor-pointer"
          onClick={openCommand}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") openCommand()
          }}
        >
          <button
            className="flex size-8 shrink-0 items-center justify-center rounded-full -ml-0.5 hover:bg-background/60"
            onClick={(e) => {
              e.stopPropagation()
              toggleSidebar()
            }}
            aria-label="Open menu"
          >
            <IconMenu2 className="size-5 text-muted-foreground" />
          </button>
          <IconSearch className="size-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground text-sm flex-1">
            Search...
          </span>
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
                <IconSun className="hidden dark:block" />
                <IconMoon className="block dark:hidden" />
                Toggle theme
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleLogout}>
                <IconLogout />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* desktop header: traditional layout */}
      <div className="hidden h-14 w-full items-center gap-2 border-b px-4 md:flex">
        <SidebarTrigger className="-ml-1" />

        <div
          className="relative mx-auto w-full max-w-md cursor-pointer"
          onClick={openCommand}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") openCommand()
          }}
        >
          <IconSearch className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <div className="bg-muted/50 border-input flex h-9 w-full items-center rounded-md border pl-9 pr-3 text-sm">
            <span className="text-muted-foreground flex-1">
              Search...
            </span>
            <kbd className="bg-muted text-muted-foreground pointer-events-none ml-2 hidden sm:inline-flex h-5 items-center gap-0.5 rounded border px-1.5 font-mono text-xs">
              <span className="text-xs">&#x2318;</span>K
            </kbd>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground text-xs"
            onClick={openFeedback}
          >
            Feedback
          </Button>
          <NotificationsPopover />
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <IconSun className="size-4 hidden dark:block" />
            <IconMoon className="size-4 block dark:hidden" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="size-7 grayscale">
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
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleLogout}>
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
