"use client"

import * as React from "react"

/**
 * Run `callback` immediately and then every `intervalMs` while `enabled` and
 * the tab is visible. Hidden tabs stop polling; returning to the tab runs the
 * callback right away so data catches up without waiting for the next tick.
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
  enabled = true
): void {
  const callbackRef = React.useRef(callback)
  callbackRef.current = callback

  React.useEffect(() => {
    if (!enabled) return
    let timer: number | null = null

    const stop = (): void => {
      if (timer !== null) window.clearInterval(timer)
      timer = null
    }
    const start = (): void => {
      stop()
      callbackRef.current()
      timer = window.setInterval(() => callbackRef.current(), intervalMs)
    }
    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") start()
      else stop()
    }

    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [enabled, intervalMs])
}
