"use client"

import type * as React from "react"
import { cn } from "@/lib/utils"

export type TowerSegment = {
  readonly key: string
  readonly label: string
  readonly value: number
  /** Theme token, e.g. "--chart-1", so the towers follow the active theme. */
  readonly colorToken: string
}

export type Tower = {
  readonly id: string
  readonly label: string
  readonly sublabel?: string
  readonly segments: readonly TowerSegment[]
  /** Small marker above the count, e.g. a streak. */
  readonly badge?: string
  readonly highlight?: boolean
  /** A short-tower floor so empty items still show (e.g. neglected jobs). */
  readonly minHeight?: number
}

const MAX_HEIGHT = 140
const WIDTH = 36
const DEPTH = 14

/**
 * Isometric 3D towers with stacked segments, drawn from theme tokens only
 * (sides and tops are the same color, shaded with brightness). Each tower is
 * a button that selects or clears a filter; heights animate when data changes.
 */
export function StackedTowers({
  towers,
  activeId,
  onSelect,
  ariaLabel,
  emptyMessage,
}: {
  readonly towers: readonly Tower[]
  readonly activeId: string | null
  readonly onSelect: (id: string | null) => void
  readonly ariaLabel: string
  readonly emptyMessage: string
}): React.ReactElement {
  if (towers.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
  }
  const max = Math.max(1, ...towers.map((tower) => tower.segments.reduce((sum, segment) => sum + segment.value, 0)))
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-start gap-3 px-1 pt-2" role="group" aria-label={ariaLabel}>
        {towers.map((tower) => {
          const total = tower.segments.reduce((sum, segment) => sum + segment.value, 0)
          const height = Math.max(tower.minHeight ?? 4, Math.round((total / max) * MAX_HEIGHT))
          const active = activeId === tower.id
          const dimmed = activeId !== null && !active
          const description = tower.segments.filter((segment) => segment.value > 0).map((segment) => `${segment.value} ${segment.label}`).join(", ")
          let offset = 0
          return (
            <button
              key={tower.id}
              type="button"
              aria-pressed={active}
              aria-label={`${tower.label}: ${total}${description ? ` (${description})` : ""}. ${active ? "Clear filter" : "Show only this"}`}
              title={description || "No logged contact"}
              onClick={() => onSelect(active ? null : tower.id)}
              className={cn(
                "group flex w-20 flex-col items-center gap-1 rounded-lg px-1 pt-1 pb-1.5 outline-none transition-[background-color,opacity] focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-muted" : "hover:bg-muted/50",
                dimmed && "opacity-45",
              )}
            >
              <span className="h-4 text-xs font-medium text-primary">{tower.badge ?? ""}</span>
              <span className={cn("text-lg font-semibold tabular-nums leading-none", tower.highlight && "text-primary")}>{total}</span>
              <span aria-hidden className="relative block" style={{ width: WIDTH + DEPTH, height: MAX_HEIGHT + DEPTH }}>
                {tower.segments.map((segment) => {
                  if (segment.value <= 0) return null
                  const segmentHeight = Math.max(2, Math.round((segment.value / total) * height))
                  const bottom = offset
                  offset += segmentHeight
                  const color = `var(${segment.colorToken})`
                  return (
                    <span key={segment.key}>
                      <span className="absolute left-0 block transition-all duration-500" style={{ bottom, width: WIDTH, height: segmentHeight, background: color }} />
                      <span
                        className="absolute block brightness-75 transition-all duration-500"
                        style={{ bottom, left: WIDTH, width: DEPTH, height: segmentHeight, background: color, transform: "skewY(-45deg)", transformOrigin: "bottom left" }}
                      />
                    </span>
                  )
                })}
                {total === 0 ? (
                  <span className="absolute bottom-0 left-0 block bg-muted-foreground/30" style={{ width: WIDTH, height }} />
                ) : null}
                <span
                  className={cn("absolute left-0 block brightness-125 transition-all duration-500", tower.highlight && "ring-2 ring-primary")}
                  style={{
                    bottom: Math.max(offset, height),
                    width: WIDTH,
                    height: DEPTH,
                    background: total === 0 ? "var(--muted-foreground)" : `var(${tower.segments.filter((segment) => segment.value > 0).at(-1)?.colorToken ?? "--primary"})`,
                    opacity: total === 0 ? 0.3 : 1,
                    transform: "skewX(-45deg)",
                    transformOrigin: "bottom left",
                  }}
                />
              </span>
              <span className="line-clamp-2 h-8 text-center text-xs font-medium leading-tight">{tower.label}</span>
              {tower.sublabel ? <span className="line-clamp-1 text-center text-xs leading-tight text-muted-foreground">{tower.sublabel}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
