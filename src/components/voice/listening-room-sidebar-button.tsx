"use client"

import * as React from "react"
import { IconMusic } from "@tabler/icons-react"
import { useListeningRoomDock } from "@/components/voice/listening-room-dock-provider"
import { useListeningRoomStatus } from "@/hooks/use-listening-room-status"
import { OFFICE_TALK_LISTENING_ROOM_CHANNEL_ID } from "@/lib/listening-room"
import { cn } from "@/lib/utils"

const EQUALIZER_BARS = [
  { height: "h-2", delay: "0ms" },
  { height: "h-3", delay: "180ms" },
  { height: "h-2.5", delay: "360ms" },
] as const

function stopEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.stopPropagation()
  event.preventDefault()
}

function statusLabel(listeners: number, title: string | null, joined: boolean): string {
  const people = joined
    ? listeners > 1
      ? `you and ${listeners - 1} other${listeners === 2 ? "" : "s"} listening`
      : "you're listening"
    : `${listeners} listening`
  return title ? `Listening Room: ${title} · ${people}` : `Listening Room · ${people}`
}

/**
 * The sidebar's music note. While music plays and someone is listening it
 * lights up with a small equalizer and the listener count; it is highlighted
 * while this person is in the room.
 */
export function ListeningRoomSidebarButton(): React.ReactElement {
  const { openRoom, openChannelId, joined } = useListeningRoomDock()
  const inRoom = joined && openChannelId === OFFICE_TALK_LISTENING_ROOM_CHANNEL_ID
  const status = useListeningRoomStatus(
    OFFICE_TALK_LISTENING_ROOM_CHANNEL_ID,
    true,
    inRoom ? "in-room" : "out"
  )
  const live = status?.playing === true
  const label = live ? statusLabel(status.listeners, status.title, inRoom) : "Listening Room"

  return (
    <button
      type="button"
      onClick={(event) => {
        stopEvent(event)
        openRoom({ channelId: OFFICE_TALK_LISTENING_ROOM_CHANNEL_ID, channelName: "Office Talk" })
      }}
      onPointerDown={stopEvent}
      aria-label={live ? `Open the ${label}` : "Open the Listening Room"}
      title={label}
      className={cn(
        "flex h-7 w-full min-w-0 items-center justify-center gap-1 rounded-md transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
        live ? "text-primary" : "text-sidebar-foreground/75",
        inRoom && "bg-primary/15"
      )}
    >
      <IconMusic className="size-4 shrink-0" />
      {live ? (
        <>
          <span className="flex h-3 items-end gap-px" aria-hidden="true">
            {EQUALIZER_BARS.map((bar) => (
              <span
                key={bar.delay}
                style={{ animationDelay: bar.delay }}
                className={cn(
                  "w-0.5 origin-bottom bg-current motion-safe:animate-[compass-equalizer_0.9s_ease-in-out_infinite]",
                  bar.height
                )}
              />
            ))}
          </span>
          <span className="text-xs font-semibold tabular-nums" aria-hidden="true">
            {status.listeners}
          </span>
        </>
      ) : null}
    </button>
  )
}
