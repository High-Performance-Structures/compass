"use client"

import { useEffect, useState, useTransition, createContext, useContext, useCallback, type ReactNode } from "react"
import { KeyRoundIcon, XIcon, Loader2Icon } from "lucide-react"
import { useDesktop, useTauriReady } from "@/hooks/use-desktop"
import { useTriggerSync, useSyncStatus, updateSyncState } from "@/hooks/use-sync-status"
import { getBackupQueueCount } from "@/lib/sync/queue/mutation-queue"
import {
  detectClaudeCodeCredentials,
  areCredentialsExpired,
  isCredentialsDismissed,
  setCredentialsDismissed,
} from "@/lib/desktop/claude-code-credentials"
import {
  hasOAuthConfigured,
  storeDetectedOAuthCredentials,
} from "@/app/actions/desktop-oauth-detection"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

interface DesktopContextValue {
  isDesktop: boolean
  tauriReady: "loading" | "ready" | "error"
  triggerSync: () => Promise<boolean>
  syncStatus: "idle" | "syncing" | "error" | "offline"
  pendingCount: number
  showCredentialsBanner: boolean
  dismissCredentialsBanner: () => void
}

const DesktopContext = createContext<DesktopContextValue>({
  isDesktop: false,
  tauriReady: "loading",
  triggerSync: async () => false,
  syncStatus: "idle",
  pendingCount: 0,
  showCredentialsBanner: false,
  dismissCredentialsBanner: () => {},
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
  const [showCredentialsBanner, setShowCredentialsBanner] = useState(false)

  const dismissCredentialsBanner = useCallback(() => {
    setShowCredentialsBanner(false)
  }, [])

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

        // Check for Claude Code credentials and offer to use them
        if (!isCredentialsDismissed()) {
          const creds = await detectClaudeCodeCredentials()
          if (creds && !areCredentialsExpired(creds)) {
            const hasExisting = await hasOAuthConfigured()
            if (!hasExisting) {
              setShowCredentialsBanner(true)
            }
          }
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
        const { WindowManager } = await import("@/lib/desktop/window-manager")
        unregister = await registerShortcuts({
          triggerSync,
          onZoomIn: () => {
            const current = WindowManager.getZoom()
            WindowManager.setZoom(Math.round((current + 0.1) * 10) / 10)
          },
          onZoomOut: () => {
            const current = WindowManager.getZoom()
            WindowManager.setZoom(Math.round((current - 0.1) * 10) / 10)
          },
          onZoomReset: () => {
            WindowManager.setZoom(1.0)
          },
        })
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
        showCredentialsBanner,
        dismissCredentialsBanner,
      }}
    >
      {showCredentialsBanner && (
        <ClaudeCodeDetectionBannerInternal
          onDismiss={dismissCredentialsBanner}
        />
      )}
      {children}
    </DesktopContext.Provider>
  )
}

// Internal banner component that uses the context
function ClaudeCodeDetectionBannerInternal({
  onDismiss,
}: {
  onDismiss: () => void
}) {
  const [dismissed, setDismissed] = useState(false)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (dismissed) return null

  const handleDismiss = () => {
    if (dontAskAgain) {
      setCredentialsDismissed()
    }
    setDismissed(true)
    onDismiss()
  }

  const handleUseCredentials = () => {
    startTransition(async () => {
      const creds = await detectClaudeCodeCredentials()
      if (!creds || areCredentialsExpired(creds)) {
        setDismissed(true)
        onDismiss()
        return
      }

      const result = await storeDetectedOAuthCredentials(
        creds.accessToken,
        creds.refreshToken,
        creds.expiresAt
      )

      if (result.success) {
        setDismissed(true)
        onDismiss()
      }
    })
  }

  return (
    <div className="bg-primary/10 border-b border-primary/20 px-4 py-3 fixed top-0 left-0 right-0 z-50">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <KeyRoundIcon className="text-primary h-5 w-5 shrink-0" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              Claude Code credentials detected
            </span>
            <span className="text-muted-foreground text-xs">
              Use them for the Compass agent?
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <Checkbox
              checked={dontAskAgain}
              onCheckedChange={(checked) =>
                setDontAskAgain(checked === true)
              }
            />
            Don&apos;t ask again
          </label>

          <Button
            variant="ghost"
            size="xs"
            onClick={handleDismiss}
            disabled={isPending}
          >
            <XIcon className="h-3 w-3" />
          </Button>

          <Button
            size="xs"
            onClick={handleUseCredentials}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2Icon className="h-3 w-3 animate-spin" />
            ) : (
              "Use Credentials"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
