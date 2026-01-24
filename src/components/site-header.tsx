"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import {
  IconLogout,
  IconMoon,
  IconSearch,
  IconSun,
  IconUserCircle,
} from "@tabler/icons-react"

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
import { SidebarTrigger } from "@/components/ui/sidebar"
import { NotificationsPopover } from "@/components/notifications-popover"
import { useCommandMenu } from "@/components/command-menu-provider"
import { useFeedback } from "@/components/feedback-widget"
import { AccountModal } from "@/components/account-modal"

export function SiteHeader() {
  const { theme, setTheme } = useTheme()
  const { open: openCommand } = useCommandMenu()
  const { open: openFeedback } = useFeedback()
  const [accountOpen, setAccountOpen] = React.useState(false)

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2 md:px-4">
      <SidebarTrigger className="-ml-1" />

      <div
        className="relative mx-auto hidden min-[480px]:block w-full max-w-md cursor-pointer"
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

      {/* Mobile search button */}
      <Button
        variant="ghost"
        size="icon"
        className="size-8 min-[480px]:hidden ml-auto"
        onClick={openCommand}
      >
        <IconSearch className="size-4" />
      </Button>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground text-xs hidden sm:inline-flex"
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
                <AvatarImage src="/avatars/martine.jpg" alt="Martine Vogel" />
                <AvatarFallback className="text-xs">MV</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">Martine Vogel</p>
              <p className="text-muted-foreground text-xs">martine@compass.io</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setAccountOpen(true)}>
              <IconUserCircle />
              Account
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <IconLogout />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AccountModal open={accountOpen} onOpenChange={setAccountOpen} />
    </header>
  )
}
