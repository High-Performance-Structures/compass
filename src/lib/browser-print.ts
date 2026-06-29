"use client"

export function printAfterDomUpdate(cleanup: () => void, timeoutMs = 5000): void {
  let cleaned = false

  const resetPrintState = (): void => {
    if (cleaned) return
    cleaned = true
    cleanup()
    window.removeEventListener("afterprint", resetPrintState)
  }

  window.addEventListener("afterprint", resetPrintState)
  window.print()
  window.setTimeout(resetPrintState, timeoutMs)
}
