/*
 * Server wrapper for the dashboard and portal layouts. Outside View as it
 * renders its children untouched. While viewing it adds the persistent bar
 * and marks the tree read only for client effects (view-as-context.tsx).
 * A session that is no longer allowed (setting off, admin demoted, person
 * deactivated, already ended...) goes through /view-as/ended, which records
 * the end in Activity and returns the admin to their own Compass.
 */
import type * as React from "react"
import { redirect } from "next/navigation"

import { VIEW_AS_ENDED_PATH } from "@/lib/view-as/constants"

import { ViewAsActiveProvider } from "@/components/view-as/view-as-context"
import { ViewAsBar } from "@/components/view-as/view-as-bar"
import type { ViewAsResolution } from "@/lib/view-as/session"

export function ViewAsFrame({
  state,
  children,
}: {
  readonly state: ViewAsResolution
  readonly children: React.ReactNode
}): React.ReactElement {
  if (state.kind === "none") return <>{children}</>
  if (state.kind === "invalid") redirect(`${VIEW_AS_ENDED_PATH}?next=/dashboard`)
  return (
    <ViewAsActiveProvider active>
      <div className="flex h-screen flex-col overflow-hidden">
        <ViewAsBar targetName={state.target.displayName || state.target.email} />
        {/* The shell is built for the full screen; fit it, and its fixed sidebar, below the bar. */}
        <div className="min-h-0 flex-1 overflow-auto [&_[data-slot=sidebar-container]]:!top-10 [&_[data-slot=sidebar-container]]:!h-[calc(100svh-2.5rem)] [&_[data-slot=sidebar-wrapper]]:!h-full [&_[data-slot=sidebar-wrapper]]:!min-h-0">
          {children}
        </div>
      </div>
    </ViewAsActiveProvider>
  )
}
