"use client"

/**
 * The notice every open tab shows when a new Compass version goes live.
 *
 * What happens during an update (details in src/lib/deployment/update-window.ts):
 * - This tab learns its own Worker version from /api/deployment-version and
 *   tags its requests with it (src/lib/deployment/version-pin.ts), so Save
 *   keeps reaching the version that drew the page even after a deploy.
 * - When the version check answers from a newer version, the notice reads
 *   "Compass will update in 2 minutes - save your work now" and counts down to
 *   a time the server set, so every tab shows the same countdown.
 * - At zero it asks for a refresh. A save that fails because of the update, or
 *   a refresh while the notice shows, first copies what was typed into this
 *   tab's storage; UnsavedTextRestoreNotice puts it back after the reload.
 */

import * as React from "react"
import { IconClockHour4, IconRefresh } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { UnsavedTextRestoreNotice } from "@/components/unsaved-text-restore-notice"
import {
  formatCountdown,
  parseServerVersionInfo,
  remainingMs,
  shouldKeepOldVersion,
  updateDeadline,
} from "@/lib/deployment/update-window"
import {
  COMPASS_DEPLOYMENT_ID,
  hasDeploymentChanged,
  STALE_DEPLOYMENT_EVENT,
} from "@/lib/deployment/version"
import {
  DEPLOYMENT_VERSION_PATH,
  pinTabToVersion,
  unpinTabVersion,
} from "@/lib/deployment/version-pin"
import {
  saveSnapshot,
  snapshotTypedText,
  trackTypedFields,
} from "@/lib/deployment/unsaved-text"
import { isStaleServerActionError } from "@/lib/purchase-orders/action-errors"
import { useVisibleInterval } from "@/hooks/use-visible-interval"

const VERSION_CHECK_INTERVAL_MS = 60_000

type UpdateState =
  | { readonly kind: "none" }
  /** A newer version is live; this tab counts down to `deadline` (tab clock). */
  | { readonly kind: "announced"; readonly deadline: number }
  /** A save already failed because of an update: refresh now. */
  | { readonly kind: "stale" }

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Copy typed text into this tab's storage before the page goes away. */
function keepTypedText(): void {
  const snapshot = snapshotTypedText(document, window.location.pathname, Date.now())
  if (snapshot !== null) saveSnapshot(tabStorage(), snapshot)
}

export function DeploymentRefreshPrompt(): React.ReactElement {
  const [update, setUpdate] = React.useState<UpdateState>({ kind: "none" })
  const [now, setNow] = React.useState(() => Date.now())
  const checkingRef = React.useRef(false)
  const updateRef = React.useRef(update)
  React.useEffect(() => {
    updateRef.current = update
  }, [update])

  const markStale = React.useCallback((): void => {
    keepTypedText()
    setUpdate({ kind: "stale" })
  }, [])

  const checkForUpdate = React.useCallback(async (): Promise<void> => {
    if (checkingRef.current || document.visibilityState === "hidden") return

    checkingRef.current = true
    try {
      const response = await fetch(DEPLOYMENT_VERSION_PATH, {
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!response.ok) return
      const receivedAt = Date.now()
      const info = parseServerVersionInfo(await response.json())
      if (info === null) return

      if (!hasDeploymentChanged(COMPASS_DEPLOYMENT_ID, info.deploymentId)) {
        // The live version drew this page: remember it so requests keep
        // reaching it after the next deploy.
        if (info.workerName !== null && info.versionId !== null) {
          pinTabToVersion(info.workerName, info.versionId)
        }
        return
      }
      // Keep the first deadline this tab saw; later checks do not move it.
      setUpdate((current) =>
        current.kind === "none"
          ? { kind: "announced", deadline: updateDeadline(info, receivedAt) }
          : current
      )
      setNow(receivedAt)
    } catch {
      // A version check should never interrupt normal Compass work.
    } finally {
      checkingRef.current = false
    }
  }, [])

  React.useEffect(() => {
    const stopTracking = trackTypedFields(document)

    function handleUnhandledRejection(event: PromiseRejectionEvent): void {
      if (isStaleServerActionError(event.reason)) markStale()
    }

    function handleWindowError(event: ErrorEvent): void {
      if (isStaleServerActionError(event.error ?? event.message)) markStale()
    }

    function handlePageHide(): void {
      if (updateRef.current.kind !== "none") keepTypedText()
    }

    window.addEventListener(STALE_DEPLOYMENT_EVENT, markStale)
    window.addEventListener("unhandledrejection", handleUnhandledRejection)
    window.addEventListener("error", handleWindowError)
    window.addEventListener("pagehide", handlePageHide)

    return () => {
      stopTracking()
      window.removeEventListener(STALE_DEPLOYMENT_EVENT, markStale)
      window.removeEventListener("unhandledrejection", handleUnhandledRejection)
      window.removeEventListener("error", handleWindowError)
      window.removeEventListener("pagehide", handlePageHide)
    }
  }, [markStale])

  // Checks now, every minute while visible, on focus, and once on return to
  // a tab that missed a check.
  useVisibleInterval(() => void checkForUpdate(), VERSION_CHECK_INTERVAL_MS, {
    refreshOnFocus: true,
  })

  const deadline = update.kind === "announced" ? update.deadline : null
  const counting = deadline !== null && remainingMs(deadline, now) > 0

  // Ticks the countdown (no network). Runs on return to the tab as well, so a
  // tab that was hidden shows the right time at once.
  useVisibleInterval(() => setNow(Date.now()), 1000, {
    enabled: deadline !== null,
  })

  React.useEffect(() => {
    if (deadline !== null && !shouldKeepOldVersion(deadline, now)) {
      unpinTabVersion()
    }
  }, [deadline, now])

  function refresh(): void {
    keepTypedText()
    window.location.reload()
  }

  return (
    <>
      <UnsavedTextRestoreNotice />
      {update.kind === "none" ? null : (
        <aside
          role="alert"
          aria-live="assertive"
          data-testid="compass-update-notice"
          className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 border border-primary/30 bg-background px-4 py-3 shadow-xl"
        >
          {counting && deadline !== null ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <IconClockHour4 className="size-4" aria-hidden />
                Compass will update in{" "}
                <span className="tabular-nums" data-testid="compass-update-countdown">
                  {formatCountdown(remainingMs(deadline, now))}
                </span>{" "}
                — save your work now
              </p>
              <p className="text-xs text-muted-foreground">
                Saving keeps working until then. Refresh any time after saving.
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold">Compass has updated</p>
              <p className="text-xs text-muted-foreground">
                Refresh to keep working. Text you typed but did not save comes
                back after the refresh.
              </p>
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant={counting ? "outline" : "default"}
            onClick={refresh}
          >
            <IconRefresh className="size-4" />
            Refresh Compass
          </Button>
        </aside>
      )}
    </>
  )
}
