"use client"

import * as React from "react"
import Link from "next/link"
import { IconBan, IconEye } from "@tabler/icons-react"

import { getProjectTimeline } from "@/app/actions/project-timeline"
import { Button } from "@/components/ui/button"
import {
  filterTimeline,
  hoursText,
  PROJECT_TIMELINE_ITEM_LABELS,
  PROJECT_TIMELINE_KIND_LABELS,
  shiftDateKey,
  timelineDays,
  type ProjectTimeline,
  type ProjectTimelineCodeHours,
  type ProjectTimelineDay,
  type ProjectTimelineKind,
} from "@/lib/project-timeline/model"
import { cn } from "@/lib/utils"

const DOT_CLASS: { readonly [K in ProjectTimelineKind]: string } = {
  log: "bg-success",
  todo: "bg-info",
  contact: "bg-primary",
  duty: "bg-muted-foreground",
  machine: "bg-warning",
  schedule: "bg-border",
}

function dayLabel(date: string): string {
  const value = new Date(`${date}T12:00:00`)
  return Number.isNaN(value.getTime()) ? date : value.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function mergeCodeHours(timelines: readonly ProjectTimeline[]): readonly ProjectTimelineCodeHours[] {
  const totals = new Map<string, ProjectTimelineCodeHours>()
  for (const timeline of timelines) {
    for (const row of timeline.codeHours) {
      const current = totals.get(row.code)
      totals.set(row.code, { ...row, hours: (current?.hours ?? 0) + row.hours })
    }
  }
  return [...totals.values()].sort((a, b) => b.hours - a.hours)
}

/**
 * "What's happening" on a job's Overview: daily logs, to-dos, client contact,
 * office time, machine hours and schedule changes by day, with the hours by
 * cost code for the same stretch.
 */
export function ProjectTimelinePanel({
  projectId,
  initial,
}: {
  readonly projectId: string
  readonly initial: ProjectTimeline
}): React.ReactElement {
  const [loaded, setLoaded] = React.useState<readonly ProjectTimeline[]>([initial])
  const [filter, setFilter] = React.useState<ProjectTimelineKind | "all">("all")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const allDays: readonly ProjectTimelineDay[] = React.useMemo(
    () => timelineDays(loaded.flatMap((timeline) => timeline.days.flatMap((day) => day.items))),
    [loaded],
  )
  const days = filterTimeline(allDays, filter)
  const earliest = loaded[loaded.length - 1]?.from ?? initial.from
  const spanDays = Math.round((Date.parse(`${initial.to}T00:00:00Z`) - Date.parse(`${initial.from}T00:00:00Z`)) / 86_400_000) + 1
  const codeHours = mergeCodeHours(loaded)
  const todoHours = loaded.reduce((sum, timeline) => sum + timeline.todoHours, 0)
  const otherHours = loaded.reduce((sum, timeline) => sum + timeline.otherHours, 0)
  const counts = new Map<ProjectTimelineKind, number>()
  for (const day of allDays) for (const item of day.items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)

  function loadEarlier(): void {
    setError(null)
    startTransition(async () => {
      const result = await getProjectTimeline(projectId, shiftDateKey(earliest, -1))
      if (!result.success) {
        setError(result.error)
        return
      }
      setLoaded((current) => [...current, result.data])
    })
  }

  const filters: readonly { readonly value: ProjectTimelineKind | "all"; readonly label: string; readonly count: number }[] = [
    { value: "all", label: "All", count: total },
    ...initial.kinds.map((kind) => ({ value: kind, label: PROJECT_TIMELINE_KIND_LABELS[kind], count: counts.get(kind) ?? 0 })),
  ]

  return (
    <section aria-labelledby={`project-timeline-${projectId}`} className="grid gap-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`project-timeline-${projectId}`} className="text-sm font-semibold">What&apos;s happening</h2>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {filters.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={filter === option.value ? "default" : "outline"}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className="h-8"
            >
              {option.label}
              <span className="tabular-nums opacity-75">{option.count}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="grid min-w-0 gap-4">
          {days.length === 0 ? (
            <div className="grid gap-2 border-y py-6 text-center text-sm text-muted-foreground">
              <p>Nothing {filter === "all" ? "logged" : `in ${PROJECT_TIMELINE_KIND_LABELS[filter].toLowerCase()}`} on this job since {dayLabel(earliest)}.</p>
              <p>
                <Link href={`/dashboard/projects/${encodeURIComponent(projectId)}/daily-logs?quickAdd=daily-log`} className="text-primary underline-offset-2 hover:underline">
                  Write a daily log
                </Link>
              </p>
            </div>
          ) : (
            days.map((day) => (
              <div key={day.date} className="grid gap-1">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{dayLabel(day.date)}</h3>
                <ul className="divide-y border-y">
                  {day.items.map((item) => (
                    <li key={item.id} className="grid gap-1 py-2.5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
                      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <span className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[item.kind])} aria-hidden="true" />
                        {PROJECT_TIMELINE_ITEM_LABELS[item.kind]}
                      </span>
                      <div className="grid min-w-0 gap-0.5">
                        <p className={cn("text-sm font-medium break-words", item.blocked && "text-warning")}>
                          {item.blocked && <IconBan className="mr-1 inline size-4 align-text-bottom" aria-label="Blocked" />}
                          {item.title}
                        </p>
                        {item.body && <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">{item.body}</p>}
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {item.meta && <span className="tabular-nums">{item.meta}</span>}
                          {item.href && item.hrefLabel && (
                            <Link href={item.href} className="text-primary underline-offset-2 hover:underline">{item.hrefLabel}</Link>
                          )}
                          {item.ownerVisible && (
                            <span className="inline-flex items-center gap-1">
                              <IconEye className="size-3.5" aria-hidden="true" />
                              Shared with the owner
                            </span>
                          )}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={loadEarlier} disabled={pending}>
              {pending ? "Loading…" : `Show the ${spanDays} days before ${dayLabel(earliest)}`}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <aside aria-label="Hours by cost code" className="grid content-start gap-2 lg:border-l lg:pl-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hours by cost code</h3>
          {codeHours.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cost code hours on daily logs since {dayLabel(earliest)}.</p>
          ) : (
            <>
              <dl className="grid gap-1.5 text-sm">
                {codeHours.map((row) => (
                  <div key={row.code} className="flex justify-between gap-3">
                    <dt className="min-w-0 truncate" title={`${row.code} ${row.label}`}>
                      <span className="font-mono text-xs">{row.code}</span> {row.label}
                    </dt>
                    <dd className="shrink-0 font-medium tabular-nums">{hoursText(row.hours)}</dd>
                  </div>
                ))}
              </dl>
              <p className="border-t pt-2 text-xs text-muted-foreground tabular-nums">
                On to-dos {hoursText(todoHours)} · not on a to-do {hoursText(otherHours)}
              </p>
            </>
          )}
        </aside>
      </div>
    </section>
  )
}
