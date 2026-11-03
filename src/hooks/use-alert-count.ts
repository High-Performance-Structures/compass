"use client"

import * as React from "react"

import { useVisibleInterval } from "@/hooks/use-visible-interval"

const STALE_MESSAGE_REFRESH_MS = 5 * 60 * 1000
// Each count scans the company's jobs; clicking around should not rerun it
// on every page.
const ALERT_COUNT_NAVIGATION_MIN_MS = 60 * 1000

/**
 * A red-alert count for a sidebar link (stale messages, overdue follow-ups)
 * from a GET endpoint. Refreshes on page changes (at most once a minute) and
 * every few minutes while the tab is visible, so the red link appears
 * without a reload; a plain GET never blocks navigation.
 */
export function useAlertCount(endpoint: string, enabled: boolean, pathname: string): number {
  const [count, setCount] = React.useState(0)
  const lastLoadedAt = React.useRef(0)
  // Bumped when the endpoint or enabled state changes so a late answer is dropped.
  const generation = React.useRef(0)
  const load = React.useCallback((): void => {
    const request = generation.current
    lastLoadedAt.current = Date.now()
    void fetch(endpoint, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const next = typeof body === "object" && body !== null ? Reflect.get(body, "count") : null
        if (request === generation.current && typeof next === "number") setCount(next)
      })
      .catch(() => undefined)
  }, [endpoint])
  const loadIfStale = React.useCallback((): void => {
    if (Date.now() - lastLoadedAt.current >= ALERT_COUNT_NAVIGATION_MIN_MS) load()
  }, [load])
  React.useEffect(() => {
    generation.current += 1
    if (!enabled) {
      setCount(0)
      lastLoadedAt.current = 0
    }
    return () => {
      generation.current += 1
    }
  }, [enabled, endpoint])
  React.useEffect(() => {
    if (enabled) loadIfStale()
  }, [enabled, loadIfStale, pathname])
  // Hidden tabs skip the refresh; a page change in the last minute already counts.
  useVisibleInterval(loadIfStale, STALE_MESSAGE_REFRESH_MS, { enabled, immediate: false })
  return count
}
