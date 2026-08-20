"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { DEVELOPER_MODE_COOKIE } from "@/lib/developer-mode"

type DeveloperModeContextValue = {
  readonly canUseDeveloperMode: boolean
  readonly developerModeEnabled: boolean
  readonly setDeveloperModeEnabled: (enabled: boolean) => void
}

const WORKER_MODE_CONTEXT: DeveloperModeContextValue = {
  canUseDeveloperMode: false,
  developerModeEnabled: false,
  setDeveloperModeEnabled: () => undefined,
}

const DeveloperModeContext = React.createContext<DeveloperModeContextValue | null>(
  null,
)

export function DeveloperModeProvider({
  canUseDeveloperMode,
  initialEnabled,
  children,
}: {
  readonly canUseDeveloperMode: boolean
  readonly initialEnabled: boolean
  readonly children: React.ReactNode
}): React.ReactElement {
  const router = useRouter()
  const [enabled, setEnabled] = React.useState(
    canUseDeveloperMode && initialEnabled,
  )

  React.useEffect(() => {
    if (!canUseDeveloperMode && enabled) setEnabled(false)
  }, [canUseDeveloperMode, enabled])

  const setDeveloperModeEnabled = React.useCallback(
    (nextEnabled: boolean): void => {
      const permittedValue = canUseDeveloperMode && nextEnabled
      setEnabled(permittedValue)
      document.cookie = `${DEVELOPER_MODE_COOKIE}=${permittedValue ? "enabled" : "disabled"}; Path=/; Max-Age=31536000; SameSite=Lax`

      try {
        window.localStorage.setItem(
          "compass-dashboard-workspace-mode",
          permittedValue ? "developer" : "worker",
        )
      } catch {
        // The cookie remains the canonical preference when storage is unavailable.
      }

      router.refresh()
    },
    [canUseDeveloperMode, router],
  )

  const value = React.useMemo<DeveloperModeContextValue>(
    () => ({
      canUseDeveloperMode,
      developerModeEnabled: canUseDeveloperMode && enabled,
      setDeveloperModeEnabled,
    }),
    [canUseDeveloperMode, enabled, setDeveloperModeEnabled],
  )

  return (
    <DeveloperModeContext.Provider value={value}>
      {children}
    </DeveloperModeContext.Provider>
  )
}

export function useDeveloperMode(): DeveloperModeContextValue {
  const context = React.useContext(DeveloperModeContext)
  // Standalone previews and public surfaces fail closed to worker mode.
  return context ?? WORKER_MODE_CONTEXT
}

export function DeveloperOnly({
  children,
  fallback = null,
}: {
  readonly children: React.ReactNode
  readonly fallback?: React.ReactNode
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  return <>{developerModeEnabled ? children : fallback}</>
}

export function WorkerOnly({
  children,
  fallback = null,
}: {
  readonly children: React.ReactNode
  readonly fallback?: React.ReactNode
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  return <>{developerModeEnabled ? fallback : children}</>
}
