"use client"

import type * as React from "react"
import { cn } from "@/lib/utils"
import type { StaffMessageAgingLevel } from "@/lib/staff-message-desk/triage"

export type AgingTower = {
  readonly level: StaffMessageAgingLevel
  readonly label: string
  readonly hint: string
  readonly count: number
}

// Theme tokens only: front face solid, side and top faces shaded from it.
const TOWER_TONE: Readonly<Record<StaffMessageAgingLevel, { front: string; side: string; top: string; text: string }>> = {
  fresh: { front: "bg-success", side: "bg-success/70", top: "bg-success/45", text: "text-success" },
  needs_response: { front: "bg-info", side: "bg-info/70", top: "bg-info/45", text: "text-info" },
  aging: { front: "bg-warning", side: "bg-warning/70", top: "bg-warning/45", text: "text-warning" },
  stale: { front: "bg-destructive", side: "bg-destructive/70", top: "bg-destructive/45", text: "text-destructive" },
}

const MAX_HEIGHT = 112
const MIN_HEIGHT = 6
const DEPTH = 18

/**
 * Open messages as isometric towers by how long they've waited. Taller and
 * redder means more messages sitting without follow-up, so the backlog is
 * obvious at a glance; each tower filters the list below. Stale towers pulse
 * gently unless the viewer prefers reduced motion.
 */
export function AgingTowers({
  towers,
  activeLevel,
  onSelect,
}: {
  readonly towers: readonly AgingTower[]
  readonly activeLevel: StaffMessageAgingLevel | null
  readonly onSelect: (level: StaffMessageAgingLevel | null) => void
}): React.ReactElement {
  const max = Math.max(1, ...towers.map((tower) => tower.count))
  return (
    <div className="flex flex-wrap items-start justify-center gap-6 py-2 sm:justify-start sm:gap-10" role="group" aria-label="Open messages by age">
      {towers.map((tower) => {
        const tone = TOWER_TONE[tower.level]
        const height = tower.count === 0 ? MIN_HEIGHT : Math.max(18, Math.round((tower.count / max) * MAX_HEIGHT))
        const active = activeLevel === tower.level
        const alarming = tower.count > 0 && (tower.level === "stale" || tower.level === "aging")
        return (
          <button
            key={tower.level}
            type="button"
            onClick={() => onSelect(active ? null : tower.level)}
            aria-pressed={active}
            aria-label={`${tower.label}: ${tower.count} ${tower.count === 1 ? "message" : "messages"}. ${active ? "Show all open messages" : "Show only these"}`}
            title={tower.hint}
            className={cn(
              "group flex w-24 flex-col items-center gap-2 rounded-lg px-1 pt-2 pb-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-muted" : "hover:bg-muted/50",
            )}
          >
            <span className={cn("text-2xl font-semibold tabular-nums leading-none", tower.count > 0 ? tone.text : "text-muted-foreground")}>
              {tower.count}
            </span>
            {/* Isometric prism: front face, right side, and top, offset by DEPTH. */}
            <span
              aria-hidden
              className={cn(
                "relative block transition-transform duration-300 group-hover:-translate-y-0.5",
                alarming && tower.level === "stale" && "motion-safe:animate-pulse",
              )}
              style={{ width: 44 + DEPTH, height: MAX_HEIGHT + DEPTH }}
            >
              <span
                className={cn("absolute bottom-0 left-0 block w-11 transition-[height] duration-500", tone.front, tower.count === 0 && "opacity-30")}
                style={{ height }}
              />
              <span
                className={cn("absolute bottom-0 block transition-[height] duration-500", tone.side, tower.count === 0 && "opacity-30")}
                style={{ left: 44, width: DEPTH, height, transform: "skewY(-45deg)", transformOrigin: "bottom left" }}
              />
              <span
                className={cn("absolute left-0 block w-11 transition-[bottom] duration-500", tone.top, tower.count === 0 && "opacity-30")}
                style={{ bottom: height, height: DEPTH, transform: "skewX(-45deg)", transformOrigin: "bottom left" }}
              />
            </span>
            {/* Fixed two-line label area keeps every count and tower on the same baseline. */}
            <span className="flex h-8 items-start justify-center text-center text-xs font-medium leading-tight">{tower.label}</span>
          </button>
        )
      })}
    </div>
  )
}
