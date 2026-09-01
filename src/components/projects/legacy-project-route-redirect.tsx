"use client"

import { useEffect } from "react"

export function LegacyProjectRouteRedirect({
  destination,
}: {
  readonly destination: string
}): React.ReactElement {
  useEffect(() => {
    // The resolver may have streamed the dashboard shell before it knows
    // whether this legacy ID is aliased. A hard navigation keeps that shell
    // from being reconciled with a different project route tree, which avoids
    // the React hook-order failure seen on legacy deep links.
    window.location.replace(destination)
  }, [destination])

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center p-6">
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Redirecting to the project…
      </p>
    </main>
  )
}
