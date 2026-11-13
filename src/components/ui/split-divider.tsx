"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/*
 * A draggable line between a list and the open item beside it (the Messages
 * pages). It sets `--split-list` on its parent; the list's width reads it, so
 * the server-rendered layout stays as it is and phones keep their stacked view
 * (hide the divider below the side-by-side breakpoint with `className`).
 * Each person's width is remembered per page kind in this browser.
 */

const KEYBOARD_STEP = 2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function readSaved(storageKey: string): number | null {
  try {
    const saved = Number(window.localStorage.getItem(storageKey))
    return Number.isFinite(saved) && saved > 0 ? saved : null
  } catch {
    return null
  }
}

function save(storageKey: string, percent: number): void {
  try {
    window.localStorage.setItem(storageKey, String(Math.round(percent)))
  } catch {
    // Private windows and blocked storage just don't remember the width.
  }
}

export function SplitDivider({
  storageKey,
  defaultPercent,
  min = 20,
  max = 75,
  label = "Resize the list",
  className,
}: {
  readonly storageKey: string
  readonly defaultPercent: number
  readonly min?: number
  readonly max?: number
  readonly label?: string
  readonly className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [percent, setPercent] = React.useState(defaultPercent)

  const apply = React.useCallback((next: number) => {
    const value = clamp(next, min, max)
    ref.current?.parentElement?.style.setProperty("--split-list", `${value}%`)
    setPercent(value)
    return value
  }, [min, max])

  React.useEffect(() => {
    apply(readSaved(storageKey) ?? defaultPercent)
  }, [apply, defaultPercent, storageKey])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const parent = ref.current?.parentElement
    if (!parent || event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const rect = parent.getBoundingClientRect()
    let last = percent
    const move = (moveEvent: PointerEvent): void => {
      last = apply(((moveEvent.clientX - rect.left) / rect.width) * 100)
    }
    const up = (): void => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", up)
      document.body.style.removeProperty("user-select")
      save(storageKey, last)
    }
    document.body.style.setProperty("user-select", "none")
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === "ArrowLeft" ? -KEYBOARD_STEP : event.key === "ArrowRight" ? KEYBOARD_STEP : 0
    if (step === 0) return
    event.preventDefault()
    save(storageKey, apply(percent + step))
  }

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(percent)}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => save(storageKey, apply(defaultPercent))}
      className={cn(
        "relative w-px shrink-0 cursor-col-resize touch-none bg-border outline-none after:absolute after:inset-y-0 after:-left-1.5 after:w-3 hover:bg-primary/60 focus-visible:bg-primary",
        className,
      )}
    />
  )
}
