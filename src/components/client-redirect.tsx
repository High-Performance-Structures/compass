"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { CompassLoader } from "@/components/compass-loader"

/**
 * Redirects in the browser from a dashboard page.
 *
 * Dashboard pages stream inside the dashboard loading screen, and Next.js's
 * server `redirect()` thrown after streaming has started crashes its router
 * ("Rendered more hooks than during the previous render", React error #310)
 * before it recovers. Return this from the page instead of calling
 * `redirect()`; it looks the same as the loading screen while it navigates.
 */
export function ClientRedirect({
  href,
}: {
  readonly href: string
}): React.ReactElement {
  const router = useRouter()

  React.useEffect(() => {
    router.replace(href)
  }, [href, router])

  return (
    <div className="grid min-h-[45vh] place-items-center p-6">
      <CompassLoader label="Loading Compass…" />
    </div>
  )
}
