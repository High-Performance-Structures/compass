"use client"

/*
 * The company's selection rounds on this job (Settings > Selections): due
 * date from the job's schedule, how many selections have the owner's pick,
 * and over/under the allowance. Clicking a card shows only that round's
 * selections in the sheet below. Staff are alerted when a round is ready
 * to finalize.
 */
import * as React from "react"

import { OverUnder } from "@/components/selections/selection-choice-card"
import { Badge } from "@/components/ui/badge"
import type { RoundCard } from "@/lib/domain/selections/rounds-server"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

export function SelectionRoundCards({
  rounds,
  selected,
  onSelect,
  unassigned,
}: {
  readonly rounds: readonly RoundCard[]
  /** The round the sheet is showing, or null for all. */
  readonly selected: string | null
  readonly onSelect: (roundKey: string | null) => void
  /** Selections not in any round. */
  readonly unassigned: number
}): React.ReactElement | null {
  if (rounds.length === 0) return null
  return (
    <div className="flex flex-wrap gap-3" role="group" aria-label="Selection rounds">
      {rounds.map((round) => {
        const percent = round.total ? Math.round((round.chosen / round.total) * 100) : 0
        const active = selected === round.key
        return (
          <button
            key={round.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? null : round.key)}
            className={cn(
              "flex min-w-60 flex-1 flex-col gap-1.5 rounded-lg border bg-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "border-2 border-primary",
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="font-semibold">{round.name}</span>
              {round.ready ? <Badge>Ready to finalize</Badge> : round.total === 0 ? <Badge variant="outline">No selections</Badge> : null}
            </span>
            <span className="text-xs text-muted-foreground">{round.dueDate ? `Due ${formatDate(round.dueDate)} from the schedule` : "No schedule date"}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
            </span>
            <span className="text-sm">
              {round.chosen} of {round.total} chosen
              {round.deltaCents !== 0 && (
                <>
                  {" · "}
                  <OverUnder deltaCents={round.deltaCents} /> {round.deltaCents > 0 ? "over" : "under"} allowance
                </>
              )}
            </span>
          </button>
        )
      })}
      {unassigned > 0 && (
        <button
          type="button"
          aria-pressed={selected === ""}
          onClick={() => onSelect(selected === "" ? null : "")}
          className={cn(
            "flex min-w-40 flex-col justify-center gap-1 rounded-lg border border-dashed p-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected === "" && "border-2 border-primary",
          )}
        >
          <span className="font-semibold">No round</span>
          <span className="text-muted-foreground">{unassigned} selection{unassigned === 1 ? "" : "s"}</span>
        </button>
      )}
    </div>
  )
}
