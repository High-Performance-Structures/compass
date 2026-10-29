"use client"

import { useSyncExternalStore } from "react"

function subscribe(): () => void {
  return () => {}
}

function clientSnapshot(): boolean { return true }
function serverSnapshot(): boolean { return false }

export function useConversationClock(): {
  readonly hydrated: boolean
  readonly timeZone: string
} {
  // Hydration must reuse the server's absolute UTC labels and day boundaries.
  // After mounting, keep the existing viewer-local dates and relative times.
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)
  return { hydrated, timeZone: hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC" }
}
