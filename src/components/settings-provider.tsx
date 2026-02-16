"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

const SettingsContext = React.createContext<{
  open: () => void
}>({ open: () => {} })

export function useSettings() {
  return React.useContext(SettingsContext)
}

/**
 * Settings is now a full page at /dashboard/settings.
 * This provider keeps the useSettings().open() API working
 * for any callers that still use it (command palette, etc).
 */
export function SettingsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()

  const value = React.useMemo(
    () => ({ open: () => router.push("/dashboard/settings") }),
    [router]
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}
