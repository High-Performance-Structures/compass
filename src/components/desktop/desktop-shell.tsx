"use client"

import { useEffect, createContext, useContext, useCallback, type ReactNode } from "react"
import { useDesktop, useTauriReady } from "@/hooks/use-desktop"
import { useTriggerSync, useSyncStatus, updateSyncState } from "@/hooks/use-sync-status"
import { getBackupQueueCount } from "@/lib/sync/queue/mutation-queue"

interface DesktopContextValue {
  isDesktop: boolean
  tauriReady: "loading" | "ready" | "error"
  triggerSync: () => Promise<boolean>
  syncStatus: "idle" | "syncing" | "error" | "offline"
  pendingCount: number
}

const DesktopContext = createContext<DesktopContextValue>({
  isDesktop: false,
  tauriReady: "loading",
  triggerSync: async () => false,
  syncStatus: "idle",
  pendingCount: 0,
})

export function useDesktopContext(): DesktopContextValue {
  return useContext(DesktopContext)
}

interface DesktopShellProps {
  readonly children: ReactNode
}

// Desktop shell initializes Tauri-specific features and provides context.
// Returns children unchanged on non-desktop platforms.
export function DesktopShell({ children }: DesktopShellProps) {
  const isDesktop = useDesktop()
  const tauriReady = useTauriReady()
  const triggerSync = useTriggerSync()
  const { status: syncStatus, pendingCount } = useSyncStatus()

  // Handle beforeunload to warn about pending sync operations
  const handleBeforeUnload = useCallback(
    (event: BeforeUnloadEvent) => {
      // Check both the sync status hook and localStorage backup
      const backupCount = getBackupQueueCount()
      const hasPendingOperations = pendingCount > 0 || backupCount > 0
      const isCurrentlySyncing = syncStatus === "syncing"

      if (hasPendingOperations || isCurrentlySyncing) {
        // Modern browsers ignore custom messages, but we set it anyway
        // The browser will show a generic "Leave site?" dialog
        const message =
          isCurrentlySyncing
            ? "Sync is in progress. Closing now may result in data loss."
            : `You have ${pendingCount > 0 ? pendingCount : backupCount} pending changes waiting to sync. ` +
              "Closing now may result in data loss."

        event.preventDefault()
        event.returnValue = message
        return message
      }
    },
    [pendingCount, syncStatus]
  )

  // Handle visibility change to persist queue when app goes to background
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === "hidden" && isDesktop) {
      // The queue manager handles its own persistence, but we can trigger
      // a final persist here for safety
      updateSyncState({ pendingCount: getBackupQueueCount() })
    }
  }, [isDesktop])

  // Initialize window state restoration and sync on mount
  useEffect(() => {
    if (!isDesktop || tauriReady !== "ready") return

    async function initializeDesktop() {
      try {
        // Restore window state
        const { WindowManager } = await import("@/lib/desktop/window-manager")
        await WindowManager.restoreState()

        // Check for restored mutations from localStorage and notify sync system
        const backupCount = getBackupQueueCount()
        if (backupCount > 0) {
          console.info(`Found ${backupCount} backed-up mutations to restore`)
          updateSyncState({ pendingCount: backupCount })
        }

        // Start initial sync after a short delay (let app load first)
        const timeoutId = setTimeout(() => {
          triggerSync()
        }, 2000)

        return () => clearTimeout(timeoutId)
      } catch (error) {
        console.error("Failed to initialize desktop shell:", error)
      }
    }

    const cleanup = initializeDesktop()
    return () => {
      cleanup?.then((fn) => fn?.())
    }
  }, [isDesktop, tauriReady, triggerSync])

  // Set up keyboard shortcuts
  useEffect(() => {
    if (!isDesktop || tauriReady !== "ready") return

    let unregister: (() => void) | undefined

    async function setupShortcuts() {
      try {
        const { registerShortcuts } = await import(
          "@/lib/desktop/shortcuts"
        )
        unregister = await registerShortcuts({ triggerSync })
      } catch (error) {
        console.error("Failed to register desktop shortcuts:", error)
      }
    }

    setupShortcuts()
    return () => unregister?.()
  }, [isDesktop, tauriReady, triggerSync])

  // Set up beforeunload and visibility change handlers
  useEffect(() => {
    if (!isDesktop) return

    window.addEventListener("beforeunload", handleBeforeUnload)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [isDesktop, handleBeforeUnload, handleVisibilityChange])

  // On non-desktop, just return children
  if (!isDesktop) {
    return <>{children}</>
  }

  // Provide desktop context
  return (
    <DesktopContext.Provider
      value={{
        isDesktop,
        tauriReady,
        triggerSync,
        syncStatus,
        pendingCount,
      }}
    >
      {children}
    </DesktopContext.Provider>
  )
}
