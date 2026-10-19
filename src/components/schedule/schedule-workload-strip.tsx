"use client"

import * as React from "react"
import { IconAlertTriangle } from "@tabler/icons-react"

import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { Button } from "@/components/ui/button"
import {
  scheduleWorkload,
  type ScheduleConflict,
  type ScheduleConflictTask,
} from "@/lib/schedule/conflicts"
import { cn } from "@/lib/utils"

/** How many days the strip shows, starting today. */
const DAYS = 42

function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function dayLabel(date: string): { readonly weekday: string; readonly day: string; readonly month: string } {
  const value = new Date(`${date}T12:00:00Z`)
  return {
    weekday: value.toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" }),
    day: String(value.getUTCDate()),
    month: value.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
  }
}

/**
 * Workload across every job shown: one bar per day for the next six weeks,
 * its height the number of items scheduled that day, the part in conflict
 * drawn in the destructive color. The Conflicts button narrows the schedule
 * to items whose crew is booked on another job at the same time.
 */
export function ScheduleWorkloadStrip({
  tasks,
  conflicts,
  conflictsOnly,
  onConflictsOnlyChange,
}: {
  readonly tasks: readonly ScheduleConflictTask[]
  readonly conflicts: ReadonlyMap<string, readonly ScheduleConflict[]>
  readonly conflictsOnly: boolean
  readonly onConflictsOnlyChange: (value: boolean) => void
}): React.ReactElement {
  const [today, setToday] = React.useState<string | null>(null)
  // Today comes from the viewer's clock after mount, so server and browser agree.
  React.useEffect(() => setToday(localToday()), [])
  const days = React.useMemo(
    () => (today ? scheduleWorkload(tasks, conflicts, today, DAYS) : []),
    [conflicts, tasks, today]
  )
  const peak = Math.max(1, ...days.map((day) => day.active))
  const conflictCount = conflicts.size
  const conflictDays = days.filter((day) => day.conflicted > 0).length

  return (
    <section aria-labelledby="schedule-workload" className="mb-3 border-y py-2">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h2 id="schedule-workload" className="text-xs font-medium text-muted-foreground">
            Workload across jobs, next 6 weeks
            {conflictDays > 0 ? (
              <span className="text-destructive"> · {conflictDays} {conflictDays === 1 ? "day" : "days"} with a double-booked crew</span>
            ) : null}
          </h2>
          <ContextualHelpBeacon topicId="schedule.cross-job-workload" className="size-5" />
        </div>
        <Button
          type="button"
          size="sm"
          variant={conflictsOnly ? "destructive" : "outline"}
          className="h-7 text-xs"
          aria-pressed={conflictsOnly}
          disabled={conflictCount === 0 && !conflictsOnly}
          onClick={() => onConflictsOnlyChange(!conflictsOnly)}
        >
          <IconAlertTriangle className="size-3.5" />
          {conflictsOnly ? "Showing conflicts only" : `Conflicts (${conflictCount})`}
        </Button>
      </div>
      <ol className="flex h-14 items-end gap-px" aria-label="Items scheduled each day">
        {days.map((day) => {
          const label = dayLabel(day.date)
          const weekend = ["S"].includes(label.weekday)
          const height = (day.active / peak) * 100
          // Share of the day's bar that is in conflict.
          const conflictShare = day.active > 0 ? (day.conflicted / day.active) * 100 : 0
          return (
            <li
              key={day.date}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${label.month} ${label.day}: ${day.active} ${day.active === 1 ? "item" : "items"}${day.conflicted ? `, ${day.conflicted} in conflict` : ""}`}
            >
              <span className="sr-only">
                {label.month} {label.day}: {day.active} items{day.conflicted ? `, ${day.conflicted} in conflict` : ""}
              </span>
              <span
                aria-hidden="true"
                className={cn("relative block w-full rounded-t-sm", weekend ? "bg-muted" : "bg-primary/35")}
                style={{ height: `${Math.max(day.active ? 6 : 2, height)}%` }}
              >
                {day.conflicted ? (
                  <span className="absolute inset-x-0 bottom-0 block rounded-t-sm bg-destructive" style={{ height: `${conflictShare}%` }} />
                ) : null}
              </span>
            </li>
          )
        })}
      </ol>
      <ol className="mt-0.5 flex gap-px" aria-hidden="true">
        {days.map((day, index) => {
          const label = dayLabel(day.date)
          const showMonth = index === 0 || label.day === "1"
          return (
            <li key={day.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-xs leading-tight text-muted-foreground">
              {index % 7 === 0 || showMonth ? `${showMonth ? `${label.month} ` : ""}${label.day}` : ""}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
