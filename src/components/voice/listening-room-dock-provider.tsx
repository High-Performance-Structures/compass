"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { ListeningRoom } from "@/components/voice/listening-room"
import { isListeningRoomWindowPath } from "@/lib/listening-room"

const DOCK_STORAGE_KEY = "compass-listening-room-dock"

type DockedRoom = {
  readonly channelId: string
  readonly channelName: string
}

type ListeningRoomDockContextValue = {
  readonly openRoom: (room: DockedRoom) => void
  /** The room this person has open here, and whether they joined it. */
  readonly openChannelId: string | null
  readonly joined: boolean
}

type ListeningRoomSlotValue = {
  readonly room: DockedRoom | null
  readonly expanded: boolean
  readonly setExpanded: (expanded: boolean) => void
  readonly onJoinedChange: (joined: boolean) => void
  readonly onDismiss: () => void
}

const ListeningRoomSlotContext = React.createContext<ListeningRoomSlotValue | null>(null)

const ListeningRoomDockContext =
  React.createContext<ListeningRoomDockContextValue | null>(null)

function readDockedRoom(): DockedRoom | null {
  try {
    const raw = window.localStorage.getItem(DOCK_STORAGE_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (
      typeof value === "object" &&
      value !== null &&
      "channelId" in value &&
      "channelName" in value &&
      typeof value.channelId === "string" &&
      typeof value.channelName === "string"
    ) {
      return { channelId: value.channelId, channelName: value.channelName }
    }
  } catch {
    // Storage can be unavailable (private windows); the dock simply starts closed.
  }
  return null
}

function writeDockedRoom(room: DockedRoom | null): void {
  try {
    if (room) window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(room))
    else window.localStorage.removeItem(DOCK_STORAGE_KEY)
  } catch {
    // Remembering the dock across reloads is a convenience only.
  }
}

/**
 * Keeps the Listening Room open across dashboard pages so music keeps playing.
 * The room is only mounted for someone who opened or joined it, so nobody else
 * polls for it.
 */
export function ListeningRoomDockProvider({
  enabled,
  children,
}: {
  readonly enabled: boolean
  readonly children: React.ReactNode
}): React.ReactElement {
  const [room, setRoom] = React.useState<DockedRoom | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [joined, setJoined] = React.useState(false)
  // The pop-out window renders its own room; a dock there would play twice.
  const pathname = usePathname()
  const active = enabled && !isListeningRoomWindowPath(pathname)

  React.useEffect(() => {
    if (active) setRoom(readDockedRoom())
  }, [active])

  const handleJoinedChange = React.useCallback(
    (nowJoined: boolean) => {
      setJoined(nowJoined)
      writeDockedRoom(nowJoined ? room : null)
    },
    [room]
  )
  const handleDismiss = React.useCallback(() => {
    setJoined(false)
    writeDockedRoom(null)
    setExpanded(false)
    setRoom(null)
  }, [])

  const openRoom = React.useCallback((next: DockedRoom) => {
    setRoom(next)
    setExpanded(true)
  }, [])

  const openChannelId = active ? (room?.channelId ?? null) : null
  const value = React.useMemo(
    () => ({ openRoom, openChannelId, joined: openChannelId !== null && joined }),
    [openRoom, openChannelId, joined]
  )
  const slot = React.useMemo<ListeningRoomSlotValue>(
    () => ({
      room: active ? room : null,
      expanded,
      setExpanded,
      onJoinedChange: handleJoinedChange,
      onDismiss: handleDismiss,
    }),
    [active, room, expanded, handleJoinedChange, handleDismiss]
  )

  return (
    <ListeningRoomDockContext.Provider value={value}>
      <ListeningRoomSlotContext.Provider value={slot}>{children}</ListeningRoomSlotContext.Provider>
    </ListeningRoomDockContext.Provider>
  )
}

/**
 * Where the room renders: beside the page content (like Ask Jarvis), so the
 * open room pushes the page over instead of covering it. Minimized, the same
 * element becomes the floating mini player, so the music never restarts.
 */
export function ListeningRoomPanel(): React.ReactElement | null {
  const slot = React.useContext(ListeningRoomSlotContext)
  if (!slot?.room) return null
  return (
    <ListeningRoom
      key={slot.room.channelId}
      channelId={slot.room.channelId}
      channelName={slot.room.channelName}
      expanded={slot.expanded}
      onExpandedChange={slot.setExpanded}
      onJoinedChange={slot.onJoinedChange}
      onDismiss={slot.onDismiss}
    />
  )
}

export function useListeningRoomDock(): ListeningRoomDockContextValue {
  const context = React.useContext(ListeningRoomDockContext)
  if (!context) {
    throw new Error("useListeningRoomDock must be used inside ListeningRoomDockProvider")
  }
  return context
}
