"use client"

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react"
import { updatePresence } from "@/app/actions/presence"

type PresenceStatus = "online" | "idle" | "dnd" | "offline"

type PresenceContextValue = {
  status: PresenceStatus
  statusMessage: string | null
  lastActivity: Date | null
  isIdle: boolean
  updateStatus: (status: PresenceStatus, message?: string) => Promise<void>
}

const PresenceContext = createContext<PresenceContextValue | null>(null)

const HEARTBEAT_INTERVAL_MS = 30_000 // 30 seconds
const IDLE_TIMEOUT_MS = 300_000 // 5 minutes

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<PresenceStatus>("online")
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [lastActivity, setLastActivity] = useState<Date | null>(null)
  const [isIdle, setIsIdle] = useState(false)
  const [isVisible, setIsVisible] = useState(true)

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusRef = useRef<PresenceStatus>(status)
  const statusMessageRef = useRef<string | null>(statusMessage)
  const lastActivityCallRef = useRef<number>(0)

  // keep refs in sync with state
  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    statusMessageRef.current = statusMessage
  }, [statusMessage])

  const updateStatus = useCallback(
    async (newStatus: PresenceStatus, message?: string) => {
      const effectiveMessage = message ?? statusMessageRef.current

      setStatus(newStatus)
      if (message !== undefined) {
        setStatusMessage(message)
      }

      // if going offline, we don't need to track activity
      if (newStatus !== "offline") {
        setLastActivity(new Date())
        setIsIdle(newStatus === "idle")
      }

      try {
        await updatePresence(newStatus, effectiveMessage ?? undefined)
      } catch {
        // silently fail - presence updates are non-critical
      }
    },
    []
  )

  const resetIdleTimer = useCallback(() => {
    // clear existing timer
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }

    // if we were idle, mark as active again
    if (statusRef.current === "idle" || isIdle) {
      setIsIdle(false)
      setStatus("online")
      updatePresence("online", statusMessageRef.current ?? undefined).catch(
        () => {}
      )
    }

    setLastActivity(new Date())

    // set new idle timer
    idleTimerRef.current = setTimeout(() => {
      if (statusRef.current === "online" && isVisible) {
        setIsIdle(true)
        setStatus("idle")
        updatePresence("idle", statusMessageRef.current ?? undefined).catch(
          () => {}
        )
      }
    }, IDLE_TIMEOUT_MS)
  }, [isIdle, isVisible])

  // heartbeat function
  const sendHeartbeat = useCallback(async () => {
    // only send heartbeat if page is visible and user is online or idle
    if (!isVisible) return
    if (statusRef.current === "offline" || statusRef.current === "dnd") return

    try {
      await updatePresence(statusRef.current, statusMessageRef.current ?? undefined)
    } catch {
      // silently fail - presence updates are non-critical
    }
  }, [isVisible])

  // set up heartbeat interval
  useEffect(() => {
    heartbeatTimerRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current)
        heartbeatTimerRef.current = null
      }
    }
  }, [sendHeartbeat])

  // throttled activity handler (1 second max rate)
  const throttledHandleActivity = useCallback(() => {
    const now = Date.now()
    if (now - lastActivityCallRef.current < 1000) {
      return // skip if called within last second
    }
    lastActivityCallRef.current = now

    if (statusRef.current !== "dnd" && statusRef.current !== "offline") {
      resetIdleTimer()
    }
  }, [resetIdleTimer])

  // track user activity
  useEffect(() => {
    const activityEvents = ["mousemove", "keydown", "touchstart", "scroll"]

    for (const event of activityEvents) {
      window.addEventListener(event, throttledHandleActivity, { passive: true })
    }

    // start initial idle timer
    resetIdleTimer()

    return () => {
      for (const event of activityEvents) {
        window.removeEventListener(event, throttledHandleActivity)
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
    }
  }, [throttledHandleActivity, resetIdleTimer])

  // handle page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      const nowVisible = !document.hidden
      setIsVisible(nowVisible)

      if (nowVisible) {
        // page became visible - resume heartbeat and check if we should be idle
        resetIdleTimer()
        sendHeartbeat()
      } else {
        // page hidden - clear idle timer to pause idle detection
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current)
          idleTimerRef.current = null
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [resetIdleTimer, sendHeartbeat])

  // set offline on beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      // use navigator.sendBeacon for reliable delivery during page unload
      // the server action won't work here since the page is unloading
      // we still call it for browsers that support it, but it may not complete
      updatePresence("offline", statusMessageRef.current ?? undefined).catch(() => {})

      // as a fallback, try to use sendBeacon with a dedicated endpoint
      // this would require a separate API route, but we'll rely on the
      // server-side timeout mechanism to mark users as offline
    }

    window.addEventListener("beforeunload", handleBeforeUnload)

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [])

  // send initial presence on mount
  useEffect(() => {
    updatePresence("online").catch(() => {})
  }, [])

  const value: PresenceContextValue = {
    status,
    statusMessage,
    lastActivity,
    isIdle,
    updateStatus,
  }

  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  )
}

export function usePresence(): PresenceContextValue {
  const context = useContext(PresenceContext)
  if (!context) {
    throw new Error("usePresence must be used within a PresenceProvider")
  }
  return context
}
