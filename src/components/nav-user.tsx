"use client"

import * as React from "react"
import Link from "next/link"
import {
  IconAutomation,
  IconCreditCard,
  IconLogout,
  IconUserCircle,
  IconMicrophone,
  IconMicrophoneOff,
  IconHeadphones,
  IconHeadphonesOff,
  IconSettings,
  IconChevronUp,
} from "@tabler/icons-react"

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
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { AccountModal } from "@/components/account-modal"
import { DevicePicker } from "@/components/voice/device-picker"
import { useVoiceState } from "@/hooks/use-voice-state"
import { cn } from "@/lib/utils"
import { getInitials } from "@/lib/utils"
import type { SidebarUser } from "@/lib/auth"

function stopEvent(e: React.MouseEvent | React.PointerEvent): void {
  e.stopPropagation()
  e.preventDefault()
}

function stopPropagation(e: React.MouseEvent | React.PointerEvent): void {
  e.stopPropagation()
}

export function NavUser({
  user,
}: {
  readonly user: SidebarUser | null
}): React.ReactElement | null {
  const { isMobile } = useSidebar()
  const [accountOpen, setAccountOpen] = React.useState(false)
  const {
    isMuted,
    isDeafened,
    inputDeviceId,
    outputDeviceId,
    inputDevices,
    outputDevices,
    toggleMute,
    toggleDeafen,
    setInputDevice,
    setOutputDevice,
  } = useVoiceState()

  if (!user) {
    return null
  }

  const initials = getInitials(user.name)

  function handleLogout(): void {
    window.location.href = "/api/auth/logout"
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div
              role="button"
              tabIndex={0}
              data-slot="sidebar-menu-button"
              data-sidebar="menu-button"
              data-size="lg"
              data-active={false}
              className={cn(
                "peer/menu-button flex h-12 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding]",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground",
                "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
                "group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center! group-data-[collapsible=icon]:gap-0! group-data-[collapsible=icon]:p-2! group-data-[collapsible=icon]:[&>*:nth-child(n+2)]:hidden",
                "[data-mobile=true]_&:h-14 [data-mobile=true]_&:text-base",
              )}
            >
              <Avatar className="h-8 w-8 shrink-0 rounded-lg grayscale">
                {user.avatar && (
                  <AvatarImage src={user.avatar} alt={user.name} />
                )}
                <AvatarFallback className="rounded-lg">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground">
                {user.name}
              </span>
              {/* Voice controls -- replace the old dots icon */}
              <div className="group-data-[collapsible=icon]:hidden flex shrink-0 items-center">
                <DeviceButtonGroup
                  isMuted={isMuted}
                  onToggle={(e) => { stopEvent(e); toggleMute() }}
                  icon={isMuted ? IconMicrophoneOff : IconMicrophone}
                  label={isMuted ? "Unmute" : "Mute"}
                  dimmed={isMuted}
                  devices={inputDevices}
                  selectedDeviceId={inputDeviceId}
                  onSelectDevice={setInputDevice}
                  deviceLabel="Input Device"
                />
                <DeviceButtonGroup
                  isMuted={isDeafened}
                  onToggle={(e) => { stopEvent(e); toggleDeafen() }}
                  icon={isDeafened ? IconHeadphonesOff : IconHeadphones}
                  label={isDeafened ? "Undeafen" : "Deafen"}
                  dimmed={isDeafened}
                  devices={outputDevices}
                  selectedDeviceId={outputDeviceId}
                  onSelectDevice={setOutputDevice}
                  deviceLabel="Output Device"
                />
                <Link
                  href="/dashboard/settings"
                  onClick={stopPropagation}
                  onPointerDown={stopPropagation}
                  aria-label="Settings"
                  className="ml-px flex size-5 items-center justify-center rounded-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  <IconSettings className="size-3" />
                </Link>
              </div>
            </div>
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
                  {user.avatar && (
                    <AvatarImage src={user.avatar} alt={user.name} />
                  )}
                  <AvatarFallback className="rounded-lg">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
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
              <DropdownMenuItem asChild>
                <Link href="/dashboard/financials">
                  <IconCreditCard />
                  Financials
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/settings">
                  <IconSettings />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/automations">
                  <IconAutomation />
                  Automations
                </Link>
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
      <AccountModal
        open={accountOpen}
        onOpenChange={setAccountOpen}
        user={user}
      />
    </SidebarMenu>
  )
}

/**
 * Tight icon+chevron pair: toggle button and device picker
 * as one visual group to save horizontal space.
 */
function DeviceButtonGroup({
  onToggle,
  icon: Icon,
  label,
  dimmed,
  devices,
  selectedDeviceId,
  onSelectDevice,
  deviceLabel,
}: {
  readonly isMuted: boolean
  readonly onToggle: (e: React.MouseEvent) => void
  readonly icon: React.ComponentType<{ className?: string }>
  readonly label: string
  readonly dimmed: boolean
  readonly devices: MediaDeviceInfo[]
  readonly selectedDeviceId: string | undefined
  readonly onSelectDevice: (deviceId: string) => void
  readonly deviceLabel: string
}): React.ReactElement {
  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={onToggle}
        onPointerDown={stopEvent}
        aria-label={label}
        className={cn(
          "flex size-5 items-center justify-center rounded-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
          dimmed
            ? "text-sidebar-foreground/40"
            : "text-sidebar-foreground/60",
        )}
      >
        <Icon className="size-3" />
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={stopEvent}
            onPointerDown={stopEvent}
            aria-label={`Select ${deviceLabel.toLowerCase()}`}
            className="flex h-5 w-3 items-center justify-center rounded-sm text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <IconChevronUp className="size-2.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-64 p-0">
          <DevicePicker
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={onSelectDevice}
            label={deviceLabel}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
