import type * as React from "react"
import { cn } from "@/lib/utils"

/** The Compass mark: a ring with the needle in the sidebar accent color. */
export function CompassMark({ className }: { readonly className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 30 30" fill="none" aria-hidden="true" className={cn("size-8", className)}>
      <circle cx="15" cy="15" r="13" stroke="currentColor" strokeWidth="1.6" />
      <path d="M19.5 10.5L16.6 16.6 10.5 19.5 13.4 13.4z" className="fill-sidebar-primary stroke-sidebar-primary" strokeWidth="1" />
      <circle cx="15" cy="15" r="1.4" className="fill-sidebar" />
    </svg>
  )
}
