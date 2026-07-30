"use client"

import * as React from "react"
import { IconCompass } from "@tabler/icons-react"
import { usePathname, useSearchParams } from "next/navigation"

import { shouldTrackNavigation } from "@/lib/navigation-progress"

const DETAIL_DELAY_MS = 450
const SAFETY_TIMEOUT_MS = 15_000

function NavigationProgressContent(): React.ReactElement | null {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const routeKey = `${pathname}?${searchParams.toString()}`
  const [pending, setPending] = React.useState(false)
  const [showDetail, setShowDetail] = React.useState(false)

  React.useEffect(() => {
    setPending(false)
    setShowDetail(false)
  }, [routeKey])

  React.useEffect(() => {
    function beginNavigation(): void {
      setPending(true)
    }

    function handleClick(event: MouseEvent): void {
      if (!(event.target instanceof Element)) return
      const anchor = event.target.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (
        shouldTrackNavigation({
          currentHref: window.location.href,
          targetHref: anchor.href,
          button: event.button,
          defaultPrevented: event.defaultPrevented,
          hasModifier:
            event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
          target: anchor.target,
          download: anchor.hasAttribute("download"),
        })
      ) {
        beginNavigation()
      }
    }

    document.addEventListener("click", handleClick, true)
    window.addEventListener("popstate", beginNavigation)
    return () => {
      document.removeEventListener("click", handleClick, true)
      window.removeEventListener("popstate", beginNavigation)
    }
  }, [])

  React.useEffect(() => {
    if (!pending) return
    const detailTimer = window.setTimeout(
      () => setShowDetail(true),
      DETAIL_DELAY_MS
    )
    const safetyTimer = window.setTimeout(() => {
      setPending(false)
      setShowDetail(false)
    }, SAFETY_TIMEOUT_MS)
    return () => {
      window.clearTimeout(detailTimer)
      window.clearTimeout(safetyTimer)
    }
  }, [pending])

  if (!pending) return null

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-primary/15"
        aria-hidden="true"
      >
        <div className="h-full w-1/3 animate-[compass-route-progress_1.2s_ease-in-out_infinite] bg-primary shadow-[0_0_8px_color-mix(in_oklab,var(--primary)_65%,transparent)]" />
      </div>
      {showDetail && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-16 z-[90] flex -translate-x-1/2 items-center gap-2 border bg-background/95 px-3 py-2 text-xs font-medium shadow-md backdrop-blur-sm"
        >
          <span className="relative grid size-5 place-items-center">
            <IconCompass className="size-5 text-primary" />
            <span className="absolute h-3 w-px origin-center animate-spin bg-primary" />
          </span>
          Loading Compass…
        </div>
      )}
    </>
  )
}

export function NavigationProgress(): React.ReactElement {
  return (
    <React.Suspense fallback={null}>
      <NavigationProgressContent />
    </React.Suspense>
  )
}
