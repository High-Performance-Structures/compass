"use client"

import { useSyncExternalStore, useCallback, useEffect, useState } from "react"
import { useDesktop } from "./use-desktop"

export type SyncStatus = "idle" | "syncing" | "error" | "offline"

export interface SyncState {
  status: SyncStatus
  pendingCount: number
  lastSyncTime: number | null
  errorMessage: string | null
}

const initialState: SyncState = {
  status: "idle",
  pendingCount: 0,
  lastSyncTime: null,
  errorMessage: null,
}

// Store for sync state (used by Tauri event listeners)
let syncState = { ...initialState }
const listeners = new Set<() => void>()

function notifyListeners() {
  listeners.forEach((listener) => listener())
}

function getSyncSnapshot(): SyncState {
  return syncState
}

function getSyncServerSnapshot(): SyncState {
  return initialState
}

function subscribeToSync(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => listeners.delete(onStoreChange)
}

// Update sync state (called by Tauri event handlers)
export function updateSyncState(updates: Partial<SyncState>): void {
  syncState = { ...syncState, ...updates }
  notifyListeners()
}

// Hook to track sync queue and status
export function useSyncStatus(): SyncState {
  const isDesktop = useDesktop()

  const state = useSyncExternalStore(
    subscribeToSync,
    getSyncSnapshot,
    getSyncServerSnapshot,
  )

  // Set up Tauri event listeners for sync updates
  useEffect(() => {
    if (!isDesktop) return

    let unlisten: (() => void) | undefined

    async function setupListeners() {
      try {
        const { listen } = await import("@tauri-apps/api/event")

        // Listen for sync status changes
        const unlistenSync = await listen<SyncState>("sync:status", (event) => {
          updateSyncState(event.payload)
        })

        const unlistenQueue = await listen<{ count: number }>(
          "sync:queue-changed",
          (event) => {
            updateSyncState({ pendingCount: event.payload.count })
          },
        )

        unlisten = () => {
          unlistenSync()
          unlistenQueue()
        }
      } catch (error) {
        console.error("Failed to set up sync listeners:", error)
      }
    }

    setupListeners()
    return () => unlisten?.()
  }, [isDesktop])

  return isDesktop ? state : initialState
}

// Hook to trigger manual sync
export function useTriggerSync() {
  const isDesktop = useDesktop()

  return useCallback(async (): Promise<boolean> => {
    if (!isDesktop) return false

    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("sync_now")
      return true
    } catch (error) {
      console.error("Failed to trigger sync:", error)
      return false
    }
  }, [isDesktop])
}

// Hook for offline detection (desktop-specific with Tauri network plugin)
export function useDesktopOnlineStatus(): boolean {
  const isDesktopApp = useDesktop()
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  )

  useEffect(() => {
    if (!isDesktopApp) {
      // Web fallback
      const handleOnline = () => setOnline(true)
      const handleOffline = () => setOnline(false)
      window.addEventListener("online", handleOnline)
      window.addEventListener("offline", handleOffline)
      return () => {
        window.removeEventListener("online", handleOnline)
        window.removeEventListener("offline", handleOffline)
      }
    }

    // Use navigator events (Tauri webview supports these)
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    setOnline(navigator.onLine)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [isDesktopApp])

  return online
}
