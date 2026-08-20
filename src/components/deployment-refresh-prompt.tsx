"use client"

import * as React from "react"
import { IconRefresh } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  COMPASS_DEPLOYMENT_ID,
  hasDeploymentChanged,
  STALE_DEPLOYMENT_EVENT,
} from "@/lib/deployment/version"
import { isStaleServerActionError } from "@/lib/purchase-orders/action-errors"

const VERSION_CHECK_INTERVAL_MS = 60_000

type DeploymentVersionResponse = {
  readonly deploymentId?: unknown
}

function deploymentIdFromResponse(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const response: DeploymentVersionResponse = value
  return typeof response.deploymentId === "string"
    ? response.deploymentId
    : null
}

export function DeploymentRefreshPrompt(): React.ReactElement | null {
  const [updateAvailable, setUpdateAvailable] = React.useState(false)
  const checkingRef = React.useRef(false)

  const checkForUpdate = React.useCallback(async (): Promise<void> => {
    if (checkingRef.current || document.visibilityState === "hidden") return

    checkingRef.current = true
    try {
      const response = await fetch("/api/deployment-version", {
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!response.ok) return

      const serverDeploymentId = deploymentIdFromResponse(
        await response.json()
      )
      if (
        serverDeploymentId !== null &&
        hasDeploymentChanged(COMPASS_DEPLOYMENT_ID, serverDeploymentId)
      ) {
        setUpdateAvailable(true)
      }
    } catch {
      // A version check should never interrupt normal Compass work.
    } finally {
      checkingRef.current = false
    }
  }, [])

  React.useEffect(() => {
    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") void checkForUpdate()
    }

    function handleWindowFocus(): void {
      void checkForUpdate()
    }

    function handleStaleDeployment(): void {
      setUpdateAvailable(true)
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent): void {
      if (isStaleServerActionError(event.reason)) setUpdateAvailable(true)
    }

    function handleWindowError(event: ErrorEvent): void {
      if (isStaleServerActionError(event.error ?? event.message)) {
        setUpdateAvailable(true)
      }
    }

    void checkForUpdate()
    const intervalId = window.setInterval(
      () => void checkForUpdate(),
      VERSION_CHECK_INTERVAL_MS
    )
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleWindowFocus)
    window.addEventListener(STALE_DEPLOYMENT_EVENT, handleStaleDeployment)
    window.addEventListener("unhandledrejection", handleUnhandledRejection)
    window.addEventListener("error", handleWindowError)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleWindowFocus)
      window.removeEventListener(STALE_DEPLOYMENT_EVENT, handleStaleDeployment)
      window.removeEventListener("unhandledrejection", handleUnhandledRejection)
      window.removeEventListener("error", handleWindowError)
    }
  }, [checkForUpdate])

  if (!updateAvailable) return null

  return (
    <aside
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 border border-primary/30 bg-background px-4 py-3 shadow-xl"
    >
      <div>
        <p className="text-sm font-semibold">Compass update ready</p>
        <p className="text-xs text-muted-foreground">
          Finish or copy any unsaved work, then refresh before submitting a form.
        </p>
      </div>
      <Button type="button" size="sm" onClick={() => window.location.reload()}>
        <IconRefresh className="size-4" />
        Refresh Compass
      </Button>
    </aside>
  )
}
