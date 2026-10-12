"use client"

import * as React from "react"
import { Music2 } from "lucide-react"
import { useListeningRoomDock } from "@/components/voice/listening-room-dock-provider"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const LISTENING_ROOM_WINDOW_NAME = "compass-listening-room"

/** Opens the room in its own browser window (the "Pop out" option). */
export function openListeningRoomWindow(channelId: string): void {
  const availableWidth = window.screen.availWidth
  const availableHeight = window.screen.availHeight
  const width = Math.min(560, Math.max(420, availableWidth - 160))
  const height = Math.min(860, Math.max(640, availableHeight - 160))
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
  const path = `/dashboard/conversations/${channelId}/listening-room`
  const listeningWindow = window.open(path, LISTENING_ROOM_WINDOW_NAME, features)
  if (listeningWindow) {
    listeningWindow.focus()
    return
  }
  window.open(path, "_blank", "noopener,noreferrer")
}

/** Voice-panel button that opens the room inside Compass. */
export function ListeningRoomButton({
  channelId,
  channelName,
  className,
}: {
  readonly channelId: string
  readonly channelName: string
  readonly className?: string
}): React.ReactElement {
  const { openRoom } = useListeningRoomDock()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => openRoom({ channelId, channelName })}
          className={cn(
            "relative flex size-7 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/70 text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
            className
          )}
          aria-label="Open the Listening Room"
        >
          <Music2 className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Listening Room</TooltipContent>
    </Tooltip>
  )
}
