"use client"

/**
 * Warm a lazily loaded module after the page settles, so it is not part of
 * the initial download but is ready by the time someone opens it.
 */
export function prefetchWhenIdle(load: () => Promise<unknown>): () => void {
  if (typeof window === "undefined") return () => {}
  const run = (): void => {
    void load().catch(() => {
      /* The component retries its own import when it renders. */
    })
  }
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: 5_000 })
    return () => window.cancelIdleCallback(handle)
  }
  const timer = window.setTimeout(run, 2_000)
  return () => window.clearTimeout(timer)
}
