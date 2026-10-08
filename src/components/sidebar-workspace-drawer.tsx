"use client"

import * as React from "react"
import { IconChevronUp, IconCompass, IconPin, IconPinnedOff } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

type DrawerPhase = "closed" | "preview" | "open"

function isPortalControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const dialog = target.closest('[role="dialog"]')
  return target.closest('[data-slot="popover-content"]') !== null || (dialog !== null && dialog.getAttribute("data-sidebar") !== "sidebar")
}

export function SidebarWorkspaceDrawer({
  children,
  communicationDock,
  preferenceKey,
  collapsed,
  onExpand,
}: {
  readonly children: React.ReactNode
  readonly communicationDock: React.ReactNode
  readonly preferenceKey: string | null
  readonly collapsed: boolean
  readonly onExpand: (() => void) | null
}): React.ReactElement {
  const [phase, setPhase] = React.useState<DrawerPhase>("closed")
  const [pinned, setPinned] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const enterTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressFocusReveal = React.useRef(false)
  const drawerId = React.useId()
  const expanded = !collapsed
  const visible = expanded && (pinned || phase !== "closed")

  const clearTimers = React.useCallback((): void => {
    if (enterTimer.current !== null) clearTimeout(enterTimer.current)
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current)
  }, [])

  React.useEffect(() => {
    setPhase("closed")
    try {
      setPinned(preferenceKey !== null && window.localStorage.getItem(preferenceKey) === "true")
    } catch {
      setPinned(false)
    }
    return clearTimers
  }, [preferenceKey, clearTimers])

  React.useEffect(() => {
    function dismissOutside(event: PointerEvent): void {
      const root = rootRef.current
      if (pinned || !root || !(event.target instanceof Node) || root.contains(event.target) || isPortalControl(event.target)) return
      clearTimers()
      setPhase("closed")
    }
    document.addEventListener("pointerdown", dismissOutside, true)
    return () => document.removeEventListener("pointerdown", dismissOutside, true)
  }, [pinned, clearTimers])

  function updatePinned(nextPinned: boolean): void {
    setPinned(nextPinned)
    try {
      if (preferenceKey !== null) window.localStorage.setItem(preferenceKey, String(nextPinned))
    } catch {
      // Keep the chosen state for this session if browser storage is unavailable.
    }
  }

  function dismiss(): void {
    clearTimers()
    setPhase("closed")
  }

  return (
    <div
      ref={rootRef}
      data-slot="sidebar-workspace-drawer"
      data-open={visible}
      data-pinned={pinned}
      className="relative flex min-h-0 shrink-0 flex-col"
      onPointerEnter={() => {
        if (leaveTimer.current !== null) clearTimeout(leaveTimer.current)
      }}
      onPointerLeave={() => {
        clearTimers()
        if (pinned || phase !== "preview") return
        leaveTimer.current = setTimeout(() => {
          if (!rootRef.current?.contains(document.activeElement) && !isPortalControl(document.activeElement)) setPhase("closed")
        }, 260)
      }}
      onFocusCapture={() => {
        clearTimers()
        if (suppressFocusReveal.current) {
          suppressFocusReveal.current = false
          return
        }
        if (expanded) setPhase((current) => current === "closed" ? "preview" : current)
      }}
      onBlurCapture={(event) => {
        if (!pinned && phase === "preview" && !event.currentTarget.contains(event.relatedTarget) && !isPortalControl(event.relatedTarget)) dismiss()
      }}
      onClickCapture={(event) => {
        // Portaled photo/device controls must stay available after hover ends.
        if (event.target instanceof Element && event.target.closest('[data-slot="sidebar-workspace-drawer-panel"]')) setPhase("open")
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || isPortalControl(event.target) || pinned || !visible) return
        event.preventDefault()
        event.stopPropagation()
        suppressFocusReveal.current = document.activeElement !== triggerRef.current
        triggerRef.current?.focus()
        dismiss()
      }}
    >
      <div className="order-2 flex h-9 items-center border-t border-sidebar-border/60 px-1.5 [@media(pointer:coarse)]:h-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <button
          ref={triggerRef}
          type="button"
          aria-label={visible && (pinned || phase === "open") ? "Close Compass drawer" : "Open Compass drawer"}
          aria-expanded={visible}
          aria-controls={drawerId}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring [@media(pointer:coarse)]:h-11 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp") return
            event.preventDefault()
            if (!expanded) onExpand?.()
            setPhase("open")
            requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('[data-slot="sidebar-workspace-drawer-panel"] button')?.focus())
          }}
          onPointerEnter={(event) => {
            if (!expanded || event.pointerType === "touch" || visible) return
            clearTimers()
            enterTimer.current = setTimeout(() => setPhase("preview"), 160)
          }}
          onClick={() => {
            clearTimers()
            if (!expanded) onExpand?.()
            if (pinned && expanded) {
              updatePinned(false)
              dismiss()
            } else {
              setPhase((current) => current === "open" ? "closed" : "open")
            }
          }}
        >
          <IconCompass className="size-4 shrink-0" aria-hidden="true" />
          {/* A slim labeled row; hover preview, click, pin and keyboard behavior are unchanged. */}
          <span className="flex-1 text-left font-mono text-xs uppercase tracking-[0.14em] group-data-[collapsible=icon]:hidden">Workspace</span>
          <IconChevronUp className={cn("size-3.5 transition-transform motion-reduce:transition-none group-data-[collapsible=icon]:hidden", visible && "rotate-180")} aria-hidden="true" />
        </button>
      </div>
      <div
        id={drawerId}
        role="region"
        aria-label="Compass drawer"
        data-slot="sidebar-workspace-drawer-panel"
        inert={!visible}
        className={cn(
          "compass-sidebar-scroll order-1 max-h-[60svh] overflow-y-auto border-t border-sidebar-border bg-sidebar p-1.5 text-sidebar-foreground transition-[opacity,translate,visibility] duration-150 motion-reduce:transition-none",
          pinned && expanded ? "relative" : "absolute inset-x-0 bottom-9 z-30 [@media(pointer:coarse)]:bottom-11",
          visible ? "visible translate-y-0 opacity-100" : "invisible pointer-events-none translate-y-2 opacity-0",
        )}
      >
        {children}
        <div className="mt-1 flex items-center gap-1">
          <div className="min-w-0 flex-1">{communicationDock}</div>
          <button
            type="button"
            aria-label={pinned ? "Unpin Compass drawer" : "Pin Compass drawer open"}
            aria-pressed={pinned}
            className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            onClick={() => {
              updatePinned(!pinned)
              setPhase("preview")
            }}
          >
            {pinned ? <IconPinnedOff className="size-3.5" aria-hidden="true" /> : <IconPin className="size-3.5" aria-hidden="true" />}
            <span>{pinned ? "Unpin" : "Pin"}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
