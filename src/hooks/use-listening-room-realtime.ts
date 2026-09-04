"use client"

import * as React from "react"
import {
  parseListeningRoomServerMessage,
  type ListeningRoomConnectionStatus,
  type ListeningRoomClientMessage,
} from "@/lib/listening-room-realtime"

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const

export function useListeningRoomRealtime(input: {
  readonly channelId: string
  readonly enabled: boolean
  readonly onRoomChanged: () => void
}): {
  readonly status: ListeningRoomConnectionStatus
  readonly notifyRoomChanged: () => void
} {
  const [status, setStatus] =
    React.useState<ListeningRoomConnectionStatus>("disconnected")
  const socketRef = React.useRef<WebSocket | null>(null)
  const reconnectAttemptRef = React.useRef(0)
  const pendingNotificationRef = React.useRef(false)
  const onRoomChangedRef = React.useRef(input.onRoomChanged)

  React.useEffect(() => {
    onRoomChangedRef.current = input.onRoomChanged
  }, [input.onRoomChanged])

  React.useEffect(() => {
    if (!input.enabled) {
      socketRef.current?.close(1000, "Left listening room")
      socketRef.current = null
      reconnectAttemptRef.current = 0
      pendingNotificationRef.current = false
      setStatus("disconnected")
      return
    }

    let disposed = false
    let reconnectTimer: number | null = null

    const connect = (): void => {
      if (disposed) return
      setStatus(
        reconnectAttemptRef.current === 0 ? "connecting" : "reconnecting"
      )
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const url = new URL(
        `${protocol}//${window.location.host}/api/listening-room-sync`
      )
      url.searchParams.set("channelId", input.channelId)
      const socket = new WebSocket(url)
      socketRef.current = socket

      socket.addEventListener("open", () => {
        if (disposed || socketRef.current !== socket) return
        reconnectAttemptRef.current = 0
        setStatus("connected")
        const message: ListeningRoomClientMessage = { type: "room_changed" }
        try {
          socket.send(JSON.stringify(message))
          pendingNotificationRef.current = false
        } catch {
          pendingNotificationRef.current = true
          socket.close()
        }
      })
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return
        const message = parseListeningRoomServerMessage(event.data)
        if (message) onRoomChangedRef.current()
      })
      socket.addEventListener("close", () => {
        if (disposed || socketRef.current !== socket) return
        socketRef.current = null
        const attempt = reconnectAttemptRef.current
        const delay =
          RECONNECT_DELAYS_MS[
            Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)
          ]
        reconnectAttemptRef.current = attempt + 1
        setStatus("reconnecting")
        reconnectTimer = window.setTimeout(connect, delay)
      })
      socket.addEventListener("error", () => {
        socket.close()
      })
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      const socket = socketRef.current
      socketRef.current = null
      socket?.close(1000, "Listening room closed")
    }
  }, [input.channelId, input.enabled])

  const notifyRoomChanged = React.useCallback((): void => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      pendingNotificationRef.current = true
      return
    }
    const message: ListeningRoomClientMessage = { type: "room_changed" }
    try {
      socket.send(JSON.stringify(message))
      pendingNotificationRef.current = false
    } catch {
      pendingNotificationRef.current = true
      socket.close()
    }
  }, [])

  return { status, notifyRoomChanged }
}
