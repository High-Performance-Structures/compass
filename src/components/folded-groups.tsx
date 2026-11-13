"use client"

/*
 * Groups that start folded to one header line (name, item count, status
 * pills) with "Expand all / Collapse all" above them, so a long list of rooms
 * fits on one screen. A folded group's rows are not rendered at all, which
 * also keeps big jobs light. Used by the Selections page's Publish to owner
 * and Finish specs areas.
 */
import * as React from "react"
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { RoomPill } from "@/lib/selections/work-filter"
import { cn } from "@/lib/utils"

export type FoldedGroupsState = {
  readonly isOpen: (key: string) => boolean
  readonly toggle: (key: string) => void
  readonly expandAll: (keys: readonly string[]) => void
  readonly collapseAll: () => void
}

/** Which groups are open; every group starts folded. */
export function useFoldedGroups(): FoldedGroupsState {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set())
  return {
    isOpen: (key) => open.has(key),
    toggle: (key) =>
      setOpen((previous) => {
        const next = new Set(previous)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }),
    expandAll: (keys) => setOpen(new Set(keys)),
    collapseAll: () => setOpen(new Set()),
  }
}

export function FoldedGroupsToolbar({
  state,
  keys,
  children,
}: {
  readonly state: FoldedGroupsState
  readonly keys: readonly string[]
  /** Extra actions on the right, e.g. Import. */
  readonly children?: React.ReactNode
}): React.ReactElement {
  const allOpen = keys.length > 0 && keys.every((key) => state.isOpen(key))
  const noneOpen = keys.every((key) => !state.isOpen(key))
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={allOpen} onClick={() => state.expandAll(keys)}>
          Expand all
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={noneOpen} onClick={state.collapseAll}>
          Collapse all
        </Button>
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  )
}

const PILL_VARIANT: Readonly<Record<RoomPill["tone"], "outline" | "secondary" | "destructive" | "default">> = {
  neutral: "outline",
  attention: "secondary",
  done: "default",
  danger: "destructive",
}

export function FoldedGroup({
  title,
  subtitle,
  count,
  pills,
  open,
  onToggle,
  actions,
  leading,
  children,
}: {
  readonly title: string
  readonly subtitle?: string | null
  readonly count: number
  readonly pills: readonly RoomPill[]
  readonly open: boolean
  readonly onToggle: () => void
  /** Buttons beside the header (kept outside the fold button). */
  readonly actions?: React.ReactNode
  /** A control before the title, such as a reorder handle (kept outside the fold button). */
  readonly leading?: React.ReactNode
  readonly children: React.ReactNode
}): React.ReactElement {
  const Chevron = open ? IconChevronDown : IconChevronRight
  return (
    <section className="border bg-background" aria-label={title}>
      <div className={cn("selection-room-header flex items-center gap-2 px-3 py-2", open && "border-b")}>
        {leading}
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-1 text-left"
        >
          <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-extrabold tracking-tight">{title}</span>
          {subtitle ? <span className="text-xs text-foreground/70">{subtitle}</span> : null}
          <span className="text-xs text-muted-foreground">
            {count} item{count === 1 ? "" : "s"}
          </span>
          {pills.map((pill) => (
            <Badge key={pill.label} variant={PILL_VARIANT[pill.tone]} className="h-5 px-1.5 text-xs">
              {pill.label}
            </Badge>
          ))}
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {open ? children : null}
    </section>
  )
}
