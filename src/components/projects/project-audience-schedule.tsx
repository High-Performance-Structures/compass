"use client"

import * as React from "react"
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconList,
  IconTimeline,
} from "@tabler/icons-react"

import type { AudienceScheduleItem } from "@/app/actions/project-audience-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { OwnerScheduleView } from "@/lib/schedule/owner-visibility"

type ScheduleView = "list" | "calendar" | "gantt"

const WEEKDAYS: readonly string[] = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
]

function dateFromKey(value: string): Date {
  const [yearText, monthText, dayText] = value.split("-")
  return new Date(
    Number(yearText),
    Math.max(0, Number(monthText) - 1),
    Number(dayText)
  )
}

function dateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function monthStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

function addMonths(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1)
}

function calendarDays(month: Date): readonly Date[] {
  const first = monthStart(month)
  const gridStart = new Date(
    first.getFullYear(),
    first.getMonth(),
    1 - first.getDay()
  )
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart)
    day.setDate(gridStart.getDate() + index)
    return day
  })
}

function formatDate(value: string): string {
  return dateFromKey(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function statusLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function itemsForDay(
  items: readonly AudienceScheduleItem[],
  day: Date
): readonly AudienceScheduleItem[] {
  const key = dateKey(day)
  return items.filter((item) => item.startDate <= key && item.endDate >= key)
}

function addDays(value: Date, amount: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() + amount)
  return next
}

function daysBetween(start: string, end: string): number {
  const [startYear, startMonth, startDay] = start.split("-").map(Number)
  const [endYear, endMonth, endDay] = end.split("-").map(Number)
  const milliseconds =
    Date.UTC(endYear, endMonth - 1, endDay) -
    Date.UTC(startYear, startMonth - 1, startDay)
  return Math.round(milliseconds / 86_400_000)
}

type GanttMonth = {
  readonly key: string
  readonly label: string
  readonly left: number
  readonly width: number
}

function ProjectAudienceGantt({
  items,
}: {
  readonly items: readonly AudienceScheduleItem[]
}): React.ReactElement {
  const range = React.useMemo(() => {
    const earliest = items.reduce(
      (date, item) => (item.startDate < date ? item.startDate : date),
      items[0].startDate
    )
    const latest = items.reduce(
      (date, item) => (item.endDate > date ? item.endDate : date),
      items[0].endDate
    )
    const start = dateKey(addDays(dateFromKey(earliest), -3))
    const end = dateKey(addDays(dateFromKey(latest), 7))
    const totalDays = daysBetween(start, end) + 1
    const dayWidth =
      totalDays > 240 ? 10 : totalDays > 120 ? 14 : totalDays > 60 ? 18 : 24
    return {
      start,
      end,
      totalDays,
      dayWidth,
      chartWidth: Math.max(680, totalDays * dayWidth),
    }
  }, [items])
  const months = React.useMemo(() => {
    const segments: GanttMonth[] = []
    let cursor = dateFromKey(range.start)
    const rangeEnd = dateFromKey(range.end)

    while (cursor <= rangeEnd) {
      const monthStartDate = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        1
      )
      const nextMonth = new Date(
        cursor.getFullYear(),
        cursor.getMonth() + 1,
        1
      )
      const segmentStart =
        cursor > monthStartDate ? cursor : monthStartDate
      const monthEnd = addDays(nextMonth, -1)
      const segmentEnd = monthEnd < rangeEnd ? monthEnd : rangeEnd
      const segmentStartKey = dateKey(segmentStart)
      const segmentEndKey = dateKey(segmentEnd)
      segments.push({
        key: segmentStartKey,
        label: segmentStart.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        }),
        left: daysBetween(range.start, segmentStartKey) * range.dayWidth,
        width:
          (daysBetween(segmentStartKey, segmentEndKey) + 1) * range.dayWidth,
      })
      cursor = nextMonth
    }

    return segments
  }, [range])
  const today = dateKey(new Date())
  const todayVisible = today >= range.start && today <= range.end
  const labelWidth = 240

  return (
    <div className="overflow-auto" aria-label="Read-only project Gantt chart">
      <div
        className="relative"
        style={{ minWidth: labelWidth + range.chartWidth }}
      >
        <div className="sticky top-0 z-20 flex h-10 border-b bg-background">
          <div
            className="sticky left-0 z-30 flex shrink-0 items-center border-r bg-background px-4 text-xs font-medium"
            style={{ width: labelWidth }}
          >
            Schedule
          </div>
          <div
            className="relative shrink-0 overflow-hidden"
            style={{ width: range.chartWidth }}
          >
            {months.map((month) => (
              <div
                key={month.key}
                className="absolute inset-y-0 border-r px-2 py-2 text-xs font-medium text-muted-foreground"
                style={{ left: month.left, width: month.width }}
              >
                {month.label}
              </div>
            ))}
          </div>
        </div>

        {items.map((item) => {
          const left =
            daysBetween(range.start, item.startDate) * range.dayWidth
          const width = Math.max(
            range.dayWidth,
            (daysBetween(item.startDate, item.endDate) + 1) * range.dayWidth
          )
          const percentComplete = Math.min(
            100,
            Math.max(0, item.percentComplete)
          )

          return (
            <div key={item.id} className="flex h-14 border-b">
              <div
                className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r bg-background px-4"
                style={{ width: labelWidth }}
              >
                <span className="truncate text-xs font-medium">{item.title}</span>
                <span className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {formatDate(item.startDate)} – {formatDate(item.endDate)}
                </span>
              </div>
              <div
                className="relative shrink-0"
                style={{
                  width: range.chartWidth,
                  backgroundImage:
                    "linear-gradient(to right, transparent calc(100% - 1px), var(--border) calc(100% - 1px))",
                  backgroundSize: `${range.dayWidth}px 100%`,
                }}
              >
                {todayVisible && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 z-10 w-px bg-destructive/60"
                    style={{
                      left:
                        daysBetween(range.start, today) * range.dayWidth +
                        range.dayWidth / 2,
                    }}
                  />
                )}
                <div
                  className="absolute top-3 h-8 overflow-hidden rounded-sm border border-primary/30 bg-primary/15"
                  style={{ left, width }}
                  title={`${item.title}: ${percentComplete}% complete`}
                >
                  <div
                    className="h-full bg-primary/45"
                    style={{ width: `${percentComplete}%` }}
                  />
                  <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium">
                    {percentComplete}%
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ProjectAudienceSchedule({
  items,
  presentation = "items",
}: {
  readonly items: readonly AudienceScheduleItem[]
  readonly presentation?: OwnerScheduleView
}): React.ReactElement {
  const [view, setView] = React.useState<ScheduleView>("list")
  const [visibleMonth, setVisibleMonth] = React.useState(() =>
    monthStart(new Date())
  )
  const days = React.useMemo(() => calendarDays(visibleMonth), [visibleMonth])
  const sortedItems = React.useMemo(
    () =>
      [...items].sort(
        (left, right) =>
          left.startDate.localeCompare(right.startDate) ||
          left.title.localeCompare(right.title)
      ),
    [items]
  )
  const today = dateKey(new Date())

  return (
    <section id="schedule" className="scroll-mt-24 border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold">Project Schedule</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {items.length} visible {presentation === "phases" ? "phase" : "item"}
            {items.length === 1 ? "" : "s"} · Read only
          </p>
        </div>
        <div className="flex items-center border">
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setView("list")}
          >
            <IconList className="size-4" />
            List
          </Button>
          <Button
            variant={view === "calendar" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none border-l"
            onClick={() => setView("calendar")}
          >
            <IconCalendar className="size-4" />
            Calendar
          </Button>
          <Button
            variant={view === "gantt" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none border-l"
            onClick={() => setView("gantt")}
          >
            <IconTimeline className="size-4" />
            Gantt
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">
          No schedule items are currently visible.
        </p>
      ) : view === "list" ? (
        <div className="divide-y">
          {sortedItems.map((item) => (
            <article
              key={item.id}
              className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:px-5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.phase}
                  {item.assignedTo ? ` · ${item.assignedTo}` : ""}
                </p>
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">
                {formatDate(item.startDate)} – {formatDate(item.endDate)}
              </p>
              <Badge
                variant={item.percentComplete === 100 ? "secondary" : "outline"}
              >
                {item.percentComplete === 100
                  ? "Complete"
                  : item.isMilestone
                    ? "Milestone"
                    : `${item.percentComplete}%`}
              </Badge>
            </article>
          ))}
        </div>
      ) : view === "calendar" ? (
        <div>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() =>
                setVisibleMonth((current) => addMonths(current, -1))
              }
            >
              <IconChevronLeft className="size-4" />
            </Button>
            <div className="text-center">
              <p className="text-sm font-semibold">
                {visibleMonth.toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <button
                type="button"
                className="mt-1 text-xs text-primary hover:underline"
                onClick={() => setVisibleMonth(monthStart(new Date()))}
              >
                Today
              </button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              onClick={() =>
                setVisibleMonth((current) => addMonths(current, 1))
              }
            >
              <IconChevronRight className="size-4" />
            </Button>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[42rem]">
              <div className="grid grid-cols-7 border-b bg-muted/25">
                {WEEKDAYS.map((weekday) => (
                  <div
                    key={weekday}
                    className="px-2 py-2 text-center text-[11px] font-medium text-muted-foreground"
                  >
                    {weekday}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const key = dateKey(day)
                  const dayItems = itemsForDay(sortedItems, day)
                  const inMonth =
                    day.getMonth() === visibleMonth.getMonth()

                  return (
                    <div
                      key={key}
                      className={cn(
                        "min-h-24 border-b border-r p-1.5",
                        !inMonth &&
                          "bg-muted/20 text-muted-foreground"
                      )}
                    >
                      <p
                        className={cn(
                          "mb-1 text-xs tabular-nums",
                          key === today && "font-semibold text-primary"
                        )}
                      >
                        {day.getDate()}
                      </p>
                      <div className="space-y-1">
                        {dayItems.slice(0, 3).map((item) => (
                          <div
                            key={item.id}
                            title={`${item.title} · ${statusLabel(item.status)}`}
                            className="truncate border-l-2 border-primary bg-primary/5 px-1 py-0.5 text-[10px] leading-4"
                          >
                            {item.title}
                          </div>
                        ))}
                        {dayItems.length > 3 && (
                          <p className="px-1 text-[10px] text-muted-foreground">
                            +{dayItems.length - 3} more
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <ProjectAudienceGantt items={sortedItems} />
      )}
    </section>
  )
}
