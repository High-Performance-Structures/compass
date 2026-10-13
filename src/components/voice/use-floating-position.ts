"use client"

import * as React from "react"

const EDGE_GAP_PX = 8
const KEYBOARD_STEP_PX = 24

type Point = { readonly x: number; readonly y: number }

function readPosition(storageKey: string): Point | null {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (
      typeof value === "object" &&
      value !== null &&
      "x" in value &&
      "y" in value &&
      typeof value.x === "number" &&
      typeof value.y === "number"
    ) {
      return { x: value.x, y: value.y }
    }
  } catch {
    // Storage can be unavailable (private windows); the default corner is fine.
  }
  return null
}

function writePosition(storageKey: string, position: Point | null): void {
  try {
    if (position) window.localStorage.setItem(storageKey, JSON.stringify(position))
    else window.localStorage.removeItem(storageKey)
  } catch {
    // Remembering where it was dragged is a convenience only.
  }
}

/** Keeps the element fully on screen, whatever the window size. */
function clampToViewport(position: Point, element: HTMLElement): Point {
  const maxX = window.innerWidth - element.offsetWidth - EDGE_GAP_PX
  const maxY = window.innerHeight - element.offsetHeight - EDGE_GAP_PX
  return {
    x: Math.round(Math.min(Math.max(position.x, EDGE_GAP_PX), Math.max(maxX, EDGE_GAP_PX))),
    y: Math.round(Math.min(Math.max(position.y, EDGE_GAP_PX), Math.max(maxY, EDGE_GAP_PX))),
  }
}

/**
 * Lets a fixed, floating element be dragged by a handle anywhere on screen and
 * remembers the spot. Until it is moved, the element keeps its default corner
 * from its classes; double-clicking the handle puts it back there.
 */
export function useFloatingPosition<T extends HTMLElement>(storageKey: string, enabled: boolean) {
  const elementRef = React.useRef<T>(null)
  const dragRef = React.useRef<{ pointerId: number; offset: Point } | null>(null)
  const movedToRef = React.useRef<Point | null>(null)
  const [position, setPosition] = React.useState<Point | null>(null)
  const [dragging, setDragging] = React.useState(false)

  React.useEffect(() => {
    if (enabled) setPosition(readPosition(storageKey))
  }, [enabled, storageKey])

  // A saved spot from a bigger window, or a resized window, must stay visible.
  React.useEffect(() => {
    if (!enabled || !position) return
    const keepOnScreen = (): void => {
      const element = elementRef.current
      if (!element) return
      const next = clampToViewport(position, element)
      if (next.x !== position.x || next.y !== position.y) setPosition(next)
    }
    keepOnScreen()
    window.addEventListener("resize", keepOnScreen)
    return () => window.removeEventListener("resize", keepOnScreen)
  }, [enabled, position])

  const handleProps = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>): void => {
      const element = elementRef.current
      if (!element || event.button !== 0) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      movedToRef.current = null
      dragRef.current = {
        pointerId: event.pointerId,
        offset: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>): void => {
      const drag = dragRef.current
      const element = elementRef.current
      if (!drag || !element || drag.pointerId !== event.pointerId) return
      const next = clampToViewport(
        { x: event.clientX - drag.offset.x, y: event.clientY - drag.offset.y },
        element
      )
      movedToRef.current = next
      setPosition(next)
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>): void => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      dragRef.current = null
      setDragging(false)
      // A click without movement leaves the saved spot alone.
      if (movedToRef.current) writePosition(storageKey, movedToRef.current)
      movedToRef.current = null
    },
    onPointerCancel: (): void => {
      dragRef.current = null
      setDragging(false)
    },
    onDoubleClick: (): void => {
      writePosition(storageKey, null)
      setPosition(null)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>): void => {
      const element = elementRef.current
      const steps: Readonly<Record<string, Point>> = {
        ArrowLeft: { x: -KEYBOARD_STEP_PX, y: 0 },
        ArrowRight: { x: KEYBOARD_STEP_PX, y: 0 },
        ArrowUp: { x: 0, y: -KEYBOARD_STEP_PX },
        ArrowDown: { x: 0, y: KEYBOARD_STEP_PX },
      }
      const step = steps[event.key]
      if (!element || !step) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const next = clampToViewport({ x: rect.left + step.x, y: rect.top + step.y }, element)
      writePosition(storageKey, next)
      setPosition(next)
    },
  }

  const style: React.CSSProperties | undefined =
    enabled && position
      ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
      : undefined

  return { elementRef, handleProps, style, dragging }
}
