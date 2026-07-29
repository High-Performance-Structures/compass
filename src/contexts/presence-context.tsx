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
const ACTIVITY_SYNC_INTERVAL_MS = 60_000
const IDLE_TIMEOUT_MS = 60 * 60 * 1000

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<PresenceStatus>("online")
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [lastActivity, setLastActivity] = useState<Date | null>(() => new Date())
  const [isIdle, setIsIdle] = useState(false)

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusRef = useRef<PresenceStatus>(status)
  const statusMessageRef = useRef<string | null>(statusMessage)
  const lastActivityAtRef = useRef<number>(Date.now())
  const lastActivitySyncRef = useRef<number>(0)
  const lastActivityHandledRef = useRef<number>(0)

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
        await updatePresence(
          newStatus,
          effectiveMessage ?? undefined,
          newStatus !== "offline"
        )
      } catch {
        // silently fail - presence updates are non-critical
      }
    },
    []
  )

  const clearIdleTimer = useCallback((): void => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  const scheduleIdleTimer = useCallback((): void => {
    clearIdleTimer()
    const elapsed = Date.now() - lastActivityAtRef.current
    const remaining = Math.max(0, IDLE_TIMEOUT_MS - elapsed)
    idleTimerRef.current = setTimeout(() => {
      if (!document.hidden && statusRef.current !== "dnd") {
        setIsIdle(true)
        setStatus("idle")
        statusRef.current = "idle"
        updatePresence("idle", statusMessageRef.current ?? undefined).catch(
          () => {}
        )
      }
    }, remaining)
  }, [clearIdleTimer])

  // heartbeat function
  const sendHeartbeat = useCallback(async () => {
    // Heartbeats prove the connection is alive but must not reset inactivity.
    if (document.hidden) return
    if (statusRef.current === "offline" || statusRef.current === "dnd") return

    try {
      await updatePresence(statusRef.current, statusMessageRef.current ?? undefined)
    } catch {
      // silently fail - presence updates are non-critical
    }
  }, [])

  // set up heartbeat interval
  useEffect(() => {
    const heartbeatTimer = window.setInterval(
      sendHeartbeat,
      HEARTBEAT_INTERVAL_MS
    )

    return () => {
      window.clearInterval(heartbeatTimer)
    }
  }, [sendHeartbeat])

  const handleActivity = useCallback((): void => {
    const now = Date.now()
    if (
      statusRef.current !== "idle" &&
      now - lastActivityHandledRef.current < 1000
    ) {
      return
    }
    lastActivityHandledRef.current = now
    lastActivityAtRef.current = now
    setLastActivity(new Date(now))

    if (statusRef.current === "idle") {
      statusRef.current = "online"
      setStatus("online")
      setIsIdle(false)
    }

    scheduleIdleTimer()

    if (now - lastActivitySyncRef.current >= ACTIVITY_SYNC_INTERVAL_MS) {
      lastActivitySyncRef.current = now
      updatePresence(
        "online",
        statusMessageRef.current ?? undefined,
        true
      ).catch(() => {})
    }
  }, [scheduleIdleTimer])

  // track user activity
  useEffect(() => {
    const activityEvents = ["mousemove", "keydown", "touchstart", "scroll"]

    for (const event of activityEvents) {
      window.addEventListener(event, handleActivity, { passive: true })
    }

    scheduleIdleTimer()

    return () => {
      for (const event of activityEvents) {
        window.removeEventListener(event, handleActivity)
      }
      clearIdleTimer()
    }
  }, [clearIdleTimer, handleActivity, scheduleIdleTimer])

  // handle page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      const nowVisible = !document.hidden

      if (nowVisible) {
        if (Date.now() - lastActivityAtRef.current >= IDLE_TIMEOUT_MS) {
          setIsIdle(true)
          setStatus("idle")
          statusRef.current = "idle"
          updatePresence("idle", statusMessageRef.current ?? undefined).catch(
            () => {}
          )
        } else {
          scheduleIdleTimer()
        }
        sendHeartbeat()
      } else {
        clearIdleTimer()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [clearIdleTimer, scheduleIdleTimer, sendHeartbeat])

  // send initial presence on mount
  useEffect(() => {
    lastActivitySyncRef.current = Date.now()
    updatePresence("online", undefined, true).catch(() => {})
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
