"use client"

/*
 * Client side of View as (src/lib/view-as/). `useViewAsActive()` tells a
 * screen that it is a read-only View as copy, so effects that write merely
 * because something was looked at (mark read, mark opened, draft refresh)
 * are skipped. The server refuses those writes regardless; skipping them
 * keeps the viewed person's unread state untouched and avoids error toasts.
 */
import * as React from "react"

const ViewAsActiveContext = React.createContext(false)

export function ViewAsActiveProvider({
  active,
  children,
}: {
  readonly active: boolean
  readonly children: React.ReactNode
}): React.ReactElement {
  return <ViewAsActiveContext.Provider value={active}>{children}</ViewAsActiveContext.Provider>
}

export function useViewAsActive(): boolean {
  return React.useContext(ViewAsActiveContext)
}
