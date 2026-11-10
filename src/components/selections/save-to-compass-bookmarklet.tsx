"use client"

/*
 * The draggable "Save to Compass" bookmarks-bar button. React refuses to
 * render `javascript:` hrefs, so the href is set on the element after mount
 * from this deployment's own origin (window.location.origin): the same
 * button works for every company and the demo site. Clicking it here does
 * nothing; it only works once dragged to the bookmarks bar. Hidden where the
 * origin is not http(s) (for example inside the phone app).
 */
import * as React from "react"
import { IconBookmark } from "@tabler/icons-react"

import { buildSaveToCompassBookmarklet } from "@/lib/selections/save-to-compass"

export function SaveToCompassBookmarklet(): React.ReactElement | null {
  const linkRef = React.useRef<HTMLAnchorElement>(null)
  const [bookmarklet, setBookmarklet] = React.useState<string | null>(null)

  React.useEffect(() => {
    setBookmarklet(buildSaveToCompassBookmarklet(window.location.origin))
  }, [])

  React.useEffect(() => {
    if (bookmarklet && linkRef.current) linkRef.current.setAttribute("href", bookmarklet)
  }, [bookmarklet])

  if (!bookmarklet) return null
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Save to Compass button</h3>
      <div className="flex flex-wrap items-center gap-3">
        <a
          ref={linkRef}
          draggable
          title="Save to Compass"
          onClick={(event) => event.preventDefault()}
          className="inline-flex cursor-grab items-center gap-1.5 rounded-md border bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <IconBookmark className="size-4" aria-hidden />
          Save to Compass
        </a>
        <p className="text-xs text-muted-foreground">
          Drag this button to your bookmarks bar. On any product page, click it to save the item as a choice.
        </p>
      </div>
    </div>
  )
}
