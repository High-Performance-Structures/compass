"use client"

import * as React from "react"
import Image from "next/image"
import {
  IconChevronUp,
  IconPhotoEdit,
  IconRefresh,
  IconUpload,
  IconMessageCircle,
  IconMicrophone,
  IconMicrophoneOff,
  IconHeadphones,
  IconHeadphonesOff,
  IconVideo,
} from "@tabler/icons-react"
import { toast } from "sonner"

import { updateWorkspacePhoto } from "@/app/actions/profile"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { useConversationPanelOptional } from "@/components/conversations/conversation-panel-provider"
import { DevicePicker } from "@/components/voice/device-picker"
import { useVoiceState } from "@/hooks/use-voice-state"
import { openOfficeTalkWindow } from "@/components/site-header"
import { sidebarDeskPhotoStorageKey } from "@/lib/user-photo-storage"
import { cn } from "@/lib/utils"
import { getInitials } from "@/lib/utils"
import type { SidebarUser } from "@/lib/auth"

function stopEvent(e: React.MouseEvent | React.PointerEvent): void {
  e.stopPropagation()
  e.preventDefault()
}

function defaultSidebarPhoto(user: SidebarUser): string | null {
  return user.avatar
}

function loadSidebarPhoto(user: SidebarUser): string | null {
  if (user.sidebarDeskPhoto) return user.sidebarDeskPhoto
  try {
    return (
      window.localStorage.getItem(sidebarDeskPhotoStorageKey(user.email)) ??
      defaultSidebarPhoto(user)
    )
  } catch {
    return defaultSidebarPhoto(user)
  }
}

function saveSidebarPhoto(user: SidebarUser, dataUrl: string): void {
  try {
    window.localStorage.setItem(
      sidebarDeskPhotoStorageKey(user.email),
      dataUrl
    )
  } catch {
    // The selected photo still remains visible for this browser session.
  }
}

function resetSidebarPhoto(user: SidebarUser): void {
  try {
    window.localStorage.removeItem(sidebarDeskPhotoStorageKey(user.email))
  } catch {
    // The reset still applies for this browser session.
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }
      reject(new Error("Could not read this image."))
    }
    reader.onerror = () => reject(new Error("Could not read this image."))
    reader.readAsDataURL(file)
  })
}

function resizeSidebarPhoto(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new window.Image()
    image.onload = () => {
      const scale = Math.min(
        1,
        720 / image.naturalWidth,
        420 / image.naturalHeight
      )
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")

      if (!context) {
        resolve(dataUrl)
        return
      }

      context.drawImage(image, 0, 0, width, height)
      resolve(canvas.toDataURL("image/jpeg", 0.84))
    }
    image.onerror = () => resolve(dataUrl)
    image.src = dataUrl
  })
}

export function SidebarDeskPhoto({
  user,
}: {
  readonly user: SidebarUser | null
}): React.ReactElement | null {
  const [sidebarPhotoUrl, setSidebarPhotoUrl] = React.useState<string | null>(
    null
  )
  const [sidebarPhotoFailed, setSidebarPhotoFailed] = React.useState(false)
  const [isUpdatingPhoto, startPhotoTransition] = React.useTransition()
  const photoInputRef = React.useRef<HTMLInputElement>(null)
  const migratedLegacyPhotoFor = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!user) return
    setSidebarPhotoFailed(false)
    setSidebarPhotoUrl(loadSidebarPhoto(user))

    if (user.sidebarDeskPhoto || migratedLegacyPhotoFor.current === user.email) {
      return
    }

    try {
      const legacyPhoto = window.localStorage.getItem(
        sidebarDeskPhotoStorageKey(user.email)
      )
      if (!legacyPhoto) return

      migratedLegacyPhotoFor.current = user.email
      void updateWorkspacePhoto("sidebar", legacyPhoto)
    } catch {
      // Keep the browser-local photo when storage is unavailable.
    }
  }, [user])

  if (!user) return null

  const initials = getInitials(user.name)

  async function handleSidebarPhotoUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file || !user) return

    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.")
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      const resizedDataUrl = await resizeSidebarPhoto(dataUrl)
      const result = await updateWorkspacePhoto("sidebar", resizedDataUrl)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      saveSidebarPhoto(user, resizedDataUrl)
      setSidebarPhotoFailed(false)
      setSidebarPhotoUrl(resizedDataUrl)
      toast.success("Sidebar photo updated.")
    } catch {
      toast.error("Could not update the sidebar photo.")
    }
  }

  function handleSidebarPhotoReset(): void {
    startPhotoTransition(async () => {
      if (!user) return

      const result = await updateWorkspacePhoto("sidebar", null)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      resetSidebarPhoto(user)
      setSidebarPhotoFailed(false)
      setSidebarPhotoUrl(defaultSidebarPhoto(user))
      toast.success("Sidebar photo reset.")
    })
  }

  return (
    <div className="px-2 pb-2 group-data-[collapsible=icon]:px-1.5 group-data-[collapsible=icon]:pb-1">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="group/photo block w-full rounded-md border border-sidebar-border bg-sidebar-accent/30 p-1.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-sidebar-accent hover:shadow-md group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:shadow-none"
            aria-label="Edit sidebar photo"
          >
            <div className="relative aspect-[16/10] overflow-hidden rounded-sm bg-sidebar-accent group-data-[collapsible=icon]:aspect-square group-data-[collapsible=icon]:rounded-md">
              {sidebarPhotoUrl && !sidebarPhotoFailed ? (
                <Image
                  src={sidebarPhotoUrl}
                  alt={`${user.name}'s sidebar photo`}
                  fill
                  sizes="240px"
                  unoptimized
                  className="object-cover"
                  onError={() => setSidebarPhotoFailed(true)}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-sidebar-accent text-xs font-semibold text-sidebar-foreground/70">
                  {initials}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 hidden items-center justify-between bg-black/45 px-2 py-1 text-[11px] font-medium text-white group-hover/photo:flex group-data-[collapsible=icon]:hidden">
                <span>Desk photo</span>
                <IconPhotoEdit className="size-3.5" />
              </span>
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-72">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Sidebar photo</p>
              <p className="mt-1 text-xs text-muted-foreground">
                A small personal photo for your Compass sidebar.
              </p>
            </div>
            <div className="relative aspect-[16/10] overflow-hidden rounded-md border bg-muted">
              {sidebarPhotoUrl && !sidebarPhotoFailed ? (
                <Image
                  src={sidebarPhotoUrl}
                  alt={`${user.name}'s sidebar photo preview`}
                  fill
                  sizes="288px"
                  unoptimized
                  className="object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-muted-foreground">
                  {initials}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                className="flex-1"
                onClick={() => photoInputRef.current?.click()}
              >
                <IconUpload />
                Change photo
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSidebarPhotoReset}
                disabled={isUpdatingPhoto}
              >
                <IconRefresh />
                Reset
              </Button>
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="Choose sidebar photo"
              onChange={handleSidebarPhotoUpload}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export function SidebarCommunicationDock({
  canUseOfficeTalk = false,
  canUseDirectMessages = false,
}: {
  readonly canUseOfficeTalk?: boolean
  readonly canUseDirectMessages?: boolean
}): React.ReactElement {
  const conversationPanel = useConversationPanelOptional()
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
  const controlCount =
    2 + Number(canUseOfficeTalk) + Number(canUseDirectMessages)
  const gridColumnsClass =
    controlCount === 4
      ? "grid-cols-4"
      : controlCount === 3
        ? "grid-cols-3"
        : "grid-cols-2"

  return (
    <div className="group-data-[collapsible=icon]:hidden px-1 pb-1">
      <div
        className={cn(
          "grid items-center gap-1 rounded-md bg-sidebar-accent/20 p-1",
          gridColumnsClass,
        )}
      >
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
          className="h-8 w-full px-1"
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
          className="h-8 w-full px-1"
        />
        {canUseOfficeTalk && (
          <button
            type="button"
            onClick={(event) => {
              stopEvent(event)
              openOfficeTalkWindow()
            }}
            onPointerDown={stopEvent}
            aria-label="Open Office Talk"
            title="Office Talk"
            className="flex h-8 w-full min-w-0 items-center justify-center rounded-md bg-transparent text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <IconVideo className="size-4" />
          </button>
        )}
        {canUseDirectMessages && (
          <button
            type="button"
            onClick={(event) => {
              stopEvent(event)
              conversationPanel?.openDirectMessages()
            }}
            onPointerDown={stopEvent}
            aria-label="Direct message a team member"
            title="Direct message"
            className="flex h-8 w-full min-w-0 items-center justify-center rounded-md bg-transparent text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <IconMessageCircle className="size-4" />
          </button>
        )}
      </div>
    </div>
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
  className,
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
  readonly className?: string
}): React.ReactElement {
  return (
    <div className={cn(
      "flex w-full min-w-0 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors",
      className,
    )}>
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
