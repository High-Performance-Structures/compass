"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

const STORAGE_PREFIX = "compass-contact-review-scroll"

function storageKey(pathname: string): string {
  return `${STORAGE_PREFIX}:${pathname}`
}

function findScrollParent(element: HTMLElement | null): HTMLElement | Window {
  let current = element?.parentElement ?? null

  while (current) {
    const style = window.getComputedStyle(current)
    const canScroll =
      current.scrollHeight > current.clientHeight &&
      ["auto", "scroll"].includes(style.overflowY)

    if (canScroll) return current
    current = current.parentElement
  }

  return window
}

function getScrollTop(target: HTMLElement | Window): number {
  return target instanceof Window ? target.scrollY : target.scrollTop
}

function setScrollTop(target: HTMLElement | Window, top: number): void {
  if (target instanceof Window) {
    target.scrollTo({ top, behavior: "instant" })
    return
  }

  target.scrollTo({ top, behavior: "instant" })
}

export function ProjectContactReviewScrollRestorer(): React.ReactElement | null {
  const pathname = usePathname()
  const markerRef = React.useRef<HTMLSpanElement | null>(null)

  React.useEffect(() => {
    const key = storageKey(pathname)
    const saved = sessionStorage.getItem(key)
    if (!saved) return

    sessionStorage.removeItem(key)
    const scrollY = Number(saved)
    if (!Number.isFinite(scrollY)) return

    requestAnimationFrame(() => {
      setScrollTop(findScrollParent(markerRef.current), scrollY)
    })
  }, [pathname])

  React.useEffect(() => {
    function saveScrollPosition(event: SubmitEvent): void {
      const target = event.target
      if (!(target instanceof HTMLFormElement)) return
      if (!target.dataset.contactReviewForm) return

      sessionStorage.setItem(
        storageKey(pathname),
        String(getScrollTop(findScrollParent(target)))
      )
    }

    document.addEventListener("submit", saveScrollPosition, true)
    return () => {
      document.removeEventListener("submit", saveScrollPosition, true)
    }
  }, [pathname])

  return <span ref={markerRef} aria-hidden="true" className="hidden" />
}
