"use client"

import * as React from "react"
import { getListeningRoomStatus, type ListeningRoomStatus } from "@/app/actions/listening-room"

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

  React.useEffect(() => {
    if (!enabled) {
      setStatus(null)
      return
    }
    let cancelled = false
    const check = (): void => {
      if (document.visibilityState !== "visible") return
      void getListeningRoomStatus(channelId)
        .then((result) => {
          if (!cancelled && result.success) setStatus(result.data)
        })
        .catch(() => {
          // A missed check just keeps the last known state until the next one.
        })
    }
    check()
    const interval = window.setInterval(check, STATUS_POLL_MS)
    document.addEventListener("visibilitychange", check)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", check)
    }
  }, [channelId, enabled, refreshKey])

  return status
}
