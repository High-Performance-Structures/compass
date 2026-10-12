"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { ListeningRoom } from "@/components/voice/listening-room"

const DOCK_STORAGE_KEY = "compass-listening-room-dock"

type DockedRoom = {
  readonly channelId: string
  readonly channelName: string
}

type ListeningRoomDockContextValue = {
  readonly openRoom: (room: DockedRoom) => void
}

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
 * Hosts the Listening Room inside the dashboard so music keeps playing while
 * people move between pages. Collapsed, it is the mini player; the room is only
 * mounted for someone who opened or joined it, so nobody else polls for it.
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
  // The pop-out window renders its own room; a dock there would play twice.
  const pathname = usePathname()
  const active = enabled && !pathname.endsWith("/listening-room")

  React.useEffect(() => {
    if (active) setRoom(readDockedRoom())
  }, [active])

  const handleJoinedChange = React.useCallback(
    (joined: boolean) => writeDockedRoom(joined ? room : null),
    [room]
  )
  const handleDismiss = React.useCallback(() => {
    writeDockedRoom(null)
    setExpanded(false)
    setRoom(null)
  }, [])

  const openRoom = React.useCallback((next: DockedRoom) => {
    setRoom(next)
    setExpanded(true)
  }, [])

  const value = React.useMemo(() => ({ openRoom }), [openRoom])

  return (
    <ListeningRoomDockContext.Provider value={value}>
      {children}
      {active && room ? (
        <ListeningRoom
          key={room.channelId}
          channelId={room.channelId}
          channelName={room.channelName}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onJoinedChange={handleJoinedChange}
          onDismiss={handleDismiss}
        />
      ) : null}
    </ListeningRoomDockContext.Provider>
  )
}

export function useListeningRoomDock(): ListeningRoomDockContextValue {
  const context = React.useContext(ListeningRoomDockContext)
  if (!context) {
    throw new Error("useListeningRoomDock must be used inside ListeningRoomDockProvider")
  }
  return context
}
