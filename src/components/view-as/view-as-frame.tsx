/*
 * Server wrapper for the dashboard and portal layouts. Outside View as it
 * renders its children untouched. While viewing it adds the persistent bar
 * and marks the tree read only for client effects (view-as-context.tsx).
 * A session that is no longer allowed shows the bar and an explanation
 * instead of the screen, with Exit as the only way on.
 */
import type * as React from "react"

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
  if (state.kind === "invalid") {
    return (
      <div className="flex min-h-screen flex-col">
        <ViewAsBar targetName={null} problem={state.reason} />
        <main className="p-6">
          <p className="max-w-xl text-sm text-muted-foreground">
            This View as session can no longer be shown. Exit to return to your own Compass.
          </p>
        </main>
      </div>
    )
  }
  return (
    <ViewAsActiveProvider active>
      <div className="flex h-screen flex-col overflow-hidden">
        <ViewAsBar targetName={state.target.displayName || state.target.email} problem={null} />
        {/* The shell is built for the full screen; fit it, and its fixed sidebar, below the bar. */}
        <div className="min-h-0 flex-1 overflow-auto [&_[data-slot=sidebar-container]]:!top-10 [&_[data-slot=sidebar-container]]:!h-[calc(100svh-2.5rem)] [&_[data-slot=sidebar-wrapper]]:!h-full [&_[data-slot=sidebar-wrapper]]:!min-h-0">
          {children}
        </div>
      </div>
    </ViewAsActiveProvider>
  )
}
