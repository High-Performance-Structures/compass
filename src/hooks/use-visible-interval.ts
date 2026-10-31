"use client"

import * as React from "react"

export type VisibleIntervalOptions = {
  /** Poll only while true. Defaults to true. */
  readonly enabled?: boolean
  /** Run the callback as soon as polling starts. Defaults to true. */
  readonly immediate?: boolean
  /**
   * Also run when the window regains focus (while the tab is visible), for
   * views that should catch up the moment someone returns to them.
   */
  readonly refreshOnFocus?: boolean
}

function isTabVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden"
}

/**
 * The one way Compass polls the network from the browser. Runs `callback`
 * every `intervalMs` while `enabled` and the tab is visible:
 *
 * - hidden tabs never tick;
 * - returning to the tab runs the callback once, right away, only if a tick
 *   was missed while it was hidden; otherwise the next tick keeps its time;
 * - the latest `callback` is always used (kept in a ref), so callers need not
 *   memoize it; changing `enabled` or `intervalMs` restarts the schedule;
 * - every timer and listener is removed on unmount.
 *
 * The third argument may be a boolean (`enabled`) for older callers.
 * See docs/development/architecture-standards.md (polling) and the
 * polling-standard test that keeps raw `setInterval` out of app code.
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
  enabledOrOptions: boolean | VisibleIntervalOptions = true
): void {
  const options: VisibleIntervalOptions =
    typeof enabledOrOptions === "boolean" ? { enabled: enabledOrOptions } : enabledOrOptions
  const enabled = options.enabled ?? true
  const immediate = options.immediate ?? true
  const refreshOnFocus = options.refreshOnFocus ?? false

  const callbackRef = React.useRef(callback)
  callbackRef.current = callback

  React.useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    // When the schedule last fired (or started). A tick counts as missed once
    // a full interval has passed since then.
    let lastTickAt = Date.now()

    const clear = (): void => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
    const schedule = (delay: number): void => {
      clear()
      timer = setTimeout(() => {
        timer = null
        if (!isTabVisible()) return
        run()
      }, Math.max(0, delay))
    }
    const run = (): void => {
      lastTickAt = Date.now()
      schedule(intervalMs)
      callbackRef.current()
    }
    const handleVisibility = (): void => {
      if (!isTabVisible()) {
        clear()
        return
      }
      if (timer !== null) return
      const elapsed = Date.now() - lastTickAt
      if (elapsed >= intervalMs) run()
      else schedule(intervalMs - elapsed)
    }
    const handleFocus = (): void => {
      if (isTabVisible()) run()
    }

    if (isTabVisible()) {
      if (immediate) run()
      else schedule(intervalMs)
    } else if (immediate) {
      // Never ran: the first visible moment should load.
      lastTickAt = Date.now() - intervalMs
    }
    document.addEventListener("visibilitychange", handleVisibility)
    if (refreshOnFocus) window.addEventListener("focus", handleFocus)
    return () => {
      clear()
      document.removeEventListener("visibilitychange", handleVisibility)
      if (refreshOnFocus) window.removeEventListener("focus", handleFocus)
    }
  }, [enabled, immediate, intervalMs, refreshOnFocus])
}
