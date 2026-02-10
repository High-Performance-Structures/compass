"use client"

import * as React from "react"
import {
  IconCreditCard,
  IconDotsVertical,
  IconLogout,
  IconNotification,
  IconUserCircle,
  IconSettings,
} from "@tabler/icons-react"

import { logout } from "@/app/actions/profile"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { AccountModal } from "@/components/account-modal"
import { useSettings } from "@/components/settings-provider"
import { getInitials } from "@/lib/utils"
import type { SidebarUser } from "@/lib/auth"

export function NavUser({
  user,
}: {
  readonly user: SidebarUser | null
}) {
  const { isMobile } = useSidebar()
  const [accountOpen, setAccountOpen] = React.useState(false)
  const { open: openSettings } = useSettings()

  // Don't render if no user (shouldn't happen in authenticated routes)
  if (!user) {
    return null
  }

  const initials = getInitials(user.name)

  async function handleLogout() {
    await logout()
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                <AvatarFallback className="rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground font-bold tracking-tight shadow-sm">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="text-sidebar-foreground truncate font-medium">{user.name}</span>
                <span className="text-sidebar-foreground/70 truncate text-xs">
                  {user.email}
                </span>
              </div>
              <IconDotsVertical className="text-sidebar-foreground/70 ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                  <AvatarFallback className="rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground font-bold tracking-tight shadow-sm">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => setAccountOpen(true)}>
                <IconUserCircle />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openSettings}>
                <IconSettings />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem>
                <IconCreditCard />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem>
                <IconNotification />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout}>
              <IconLogout />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <AccountModal open={accountOpen} onOpenChange={setAccountOpen} user={user} />
    </SidebarMenu>
  )
}
