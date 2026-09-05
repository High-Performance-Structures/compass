"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"

export const QUICK_ADD_ENTRY_EVENT = "compass:quick-add"

function eventAction(event: Event): string | null {
  if (!(event instanceof CustomEvent)) return null

  const detail: unknown = event.detail
  if (
    typeof detail !== "object" ||
    detail === null ||
    !("action" in detail) ||
    typeof detail.action !== "string"
  ) {
    return null
  }

  return detail.action
}

function consumeQuickAddMarker(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete("quickAdd")
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`
  )
}

/**
 * Opens an existing creation surface for a matching quick-add navigation.
 * Consuming the marker keeps browser history clean while leaving other route
 * state intact; the custom event covers another request on the same page.
 */
export function useQuickAddEntry(
  action: string,
  onEntry: () => void
): void {
  const searchParams = useSearchParams()
  const onEntryRef = React.useRef(onEntry)
  const handledRequest = React.useRef<string | null>(null)

  React.useEffect(() => {
    onEntryRef.current = onEntry
  }, [onEntry])

  React.useEffect(() => {
    const request = searchParams.toString()
    if (searchParams.get("quickAdd") !== action) {
      handledRequest.current = null
      return
    }

    if (handledRequest.current === request) return

    handledRequest.current = request
    consumeQuickAddMarker()
    onEntryRef.current()
  }, [action, searchParams])

  React.useEffect(() => {
    function handleQuickAdd(event: Event): void {
      if (eventAction(event) === action) {
        onEntryRef.current()
      }
    }

    window.addEventListener(QUICK_ADD_ENTRY_EVENT, handleQuickAdd)
    return () => {
      window.removeEventListener(QUICK_ADD_ENTRY_EVENT, handleQuickAdd)
    }
  }, [action])
}
