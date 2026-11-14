"use client"

/*
 * Sends the browser through /view-as/ended (a route handler, so a full page
 * load rather than a router navigation) when a View as session is no longer
 * allowed. Used by ViewAsFrame instead of a server redirect().
 */
import * as React from "react"

import { VIEW_AS_ENDED_PATH } from "@/lib/view-as/constants"

export function ViewAsEndedRedirect(): React.ReactElement {
  React.useEffect(() => {
    const next = `${window.location.pathname}${window.location.search}`
    window.location.replace(`${VIEW_AS_ENDED_PATH}?next=${encodeURIComponent(next)}`)
  }, [])
  return <p className="p-6 text-sm text-muted-foreground">View as has ended. Returning to your Compass…</p>
}
