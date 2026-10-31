"use client"

import * as React from "react"
import { getListeningRoomStatus, type ListeningRoomStatus } from "@/app/actions/listening-room"
import { useVisibleInterval } from "@/hooks/use-visible-interval"

const STATUS_POLL_MS = 30_000

/**
 * Whether music is playing in a Listening Room and how many are listening,
 * refreshed while the page is visible. `refreshKey` forces an immediate check,
 * for example right after this person joins or leaves the room.
 */
export function useListeningRoomStatus(
  channelId: string,
  enabled: boolean,
  refreshKey: string
): ListeningRoomStatus | null {
  const [status, setStatus] = React.useState<ListeningRoomStatus | null>(null)
  // Bumped whenever the room or the enabled state changes, so a late answer
  // for the previous room is ignored.
  const generation = React.useRef(0)

  const check = React.useCallback((): void => {
    if (document.visibilityState !== "visible") return
    const request = generation.current
    void getListeningRoomStatus(channelId)
      .then((result) => {
        if (request === generation.current && result.success) setStatus(result.data)
      })
      .catch(() => {
        // A missed check just keeps the last known state until the next one.
      })
  }, [channelId])

  React.useEffect(() => {
    generation.current += 1
    if (!enabled) {
      setStatus(null)
      return
    }
    check()
    return () => {
      generation.current += 1
    }
  }, [check, enabled, refreshKey])

  // The effect above does the first check for each room and refresh key.
  useVisibleInterval(check, STATUS_POLL_MS, { enabled, immediate: false })

  return status
}
