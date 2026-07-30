"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconCalendar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconList,
  IconTimeline,
  IconX,
} from "@tabler/icons-react"
import { toast } from "sonner"

import { respondToScheduleTaskConfirmation } from "@/app/actions/schedule-confirmations"
import type { AudienceScheduleItem } from "@/app/actions/project-audience-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  centeredTimelineScrollLeft,
  lockWheelToDominantAxis,
  normalizeWheelDelta,
} from "@/lib/schedule/gantt-scroll"
import { cn } from "@/lib/utils"
import type { OwnerScheduleView } from "@/lib/schedule/owner-visibility"

type ScheduleView = "list" | "calendar" | "gantt"
type GanttViewMode = "Day" | "Week" | "Month"

const GANTT_DAY_WIDTH: Readonly<Record<GanttViewMode, number>> = {
  Day: 38,
  Week: 20,
  Month: 8,
}

const GANTT_PADDING_DAYS: Readonly<Record<GanttViewMode, number>> = {
  Day: 7,
  Week: 31,
  Month: 62,
}

const GANTT_VIEW_MODES: readonly GanttViewMode[] = [
  "Day",
  "Week",
  "Month",
]

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

function confirmationLabel(value: string): string {
  if (value === "confirmed") return "Confirmed"
  if (value === "declined") return "Cannot commit"
  if (value === "pending") return "Awaiting confirmation"
  if (value === "unavailable") return "Compass account needed"
  return "Not requested"
}

function ScheduleConfirmationControl({
  item,
}: {
  readonly item: AudienceScheduleItem
}): React.ReactElement | null {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  if (!item.confirmationRequired) return null

  const respond = (response: "confirmed" | "declined"): void => {
    startTransition(async () => {
      const result = await respondToScheduleTaskConfirmation(item.id, response)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        response === "confirmed"
          ? "Schedule commitment confirmed."
          : "The project team has been notified that you cannot commit."
      )
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant={item.confirmationStatus === "confirmed" ? "secondary" : "outline"}
      >
        {confirmationLabel(item.confirmationStatus)}
      </Badge>
      {item.viewerCanConfirm && item.confirmationStatus !== "confirmed" && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => respond("confirmed")}
          >
            <IconCheck className="size-4" />
            Confirm
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => respond("declined")}
          >
            <IconX className="size-4" />
            Cannot commit
          </Button>
        </>
      )}
    </div>
  )
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

type GanttTick = GanttMonth

function ProjectAudienceGantt({
  items,
}: {
  readonly items: readonly AudienceScheduleItem[]
}): React.ReactElement {
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const pendingAnchorDateRef = React.useRef<string | null>(null)
  const didInitialScrollRef = React.useRef(false)
  const [viewMode, setViewMode] = React.useState<GanttViewMode>("Week")
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(
    null
  )
  const [horizontalScroll, setHorizontalScroll] = React.useState({
    value: 0,
    maximum: 0,
  })
  const today = dateKey(new Date())
  const range = React.useMemo(() => {
    const earliestItem = items.reduce(
      (date, item) => (item.startDate < date ? item.startDate : date),
      items[0].startDate
    )
    const latestItem = items.reduce(
      (date, item) => (item.endDate > date ? item.endDate : date),
      items[0].endDate
    )
    const earliest = earliestItem < today ? earliestItem : today
    const latest = latestItem > today ? latestItem : today
    const paddingDays = GANTT_PADDING_DAYS[viewMode]
    const start = dateKey(addDays(dateFromKey(earliest), -paddingDays))
    const end = dateKey(addDays(dateFromKey(latest), paddingDays))
    const totalDays = daysBetween(start, end) + 1
    const dayWidth = GANTT_DAY_WIDTH[viewMode]
    return {
      start,
      end,
      totalDays,
      dayWidth,
      chartWidth: Math.max(680, totalDays * dayWidth),
    }
  }, [items, today, viewMode])
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
  const years = React.useMemo(() => {
    const segments: GanttMonth[] = []
    let cursor = dateFromKey(range.start)
    const rangeEnd = dateFromKey(range.end)

    while (cursor <= rangeEnd) {
      const yearStart = new Date(cursor.getFullYear(), 0, 1)
      const nextYear = new Date(cursor.getFullYear() + 1, 0, 1)
      const segmentStart = cursor > yearStart ? cursor : yearStart
      const yearEnd = addDays(nextYear, -1)
      const segmentEnd = yearEnd < rangeEnd ? yearEnd : rangeEnd
      const segmentStartKey = dateKey(segmentStart)
      const segmentEndKey = dateKey(segmentEnd)
      segments.push({
        key: segmentStartKey,
        label: String(segmentStart.getFullYear()),
        left: daysBetween(range.start, segmentStartKey) * range.dayWidth,
        width:
          (daysBetween(segmentStartKey, segmentEndKey) + 1) * range.dayWidth,
      })
      cursor = nextYear
    }

    return segments
  }, [range])
  const ticks = React.useMemo((): readonly GanttTick[] => {
    if (viewMode === "Month") {
      return months.map((month) => ({
        ...month,
        label: dateFromKey(month.key).toLocaleDateString("en-US", {
          month: "short",
        }),
      }))
    }

    const step = viewMode === "Day" ? 1 : 7
    const result: GanttTick[] = []
    const rangeEnd = dateFromKey(range.end)
    let cursor = dateFromKey(range.start)
    while (cursor <= rangeEnd) {
      const key = dateKey(cursor)
      const remainingDays = daysBetween(key, range.end) + 1
      result.push({
        key,
        label:
          viewMode === "Day"
            ? cursor.toLocaleDateString("en-US", {
                weekday: "narrow",
                day: "numeric",
              })
            : cursor.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              }),
        left: daysBetween(range.start, key) * range.dayWidth,
        width: Math.min(step, remainingDays) * range.dayWidth,
      })
      cursor = addDays(cursor, step)
    }
    return result
  }, [months, range, viewMode])
  const upperSegments = viewMode === "Month" ? years : months
  const labelWidth = 240

  const scrollToDate = React.useCallback(
    (date: string, behavior: ScrollBehavior = "smooth") => {
      const container = scrollContainerRef.current
      if (!container) return
      container.scrollTo({
        left: centeredTimelineScrollLeft({
          dayOffset: daysBetween(range.start, date),
          dayWidth: range.dayWidth,
          labelWidth,
          clientWidth: container.clientWidth,
          scrollWidth: container.scrollWidth,
        }),
        behavior,
      })
    },
    [range]
  )

  const handleViewModeChange = React.useCallback(
    (nextMode: GanttViewMode) => {
      if (nextMode === viewMode) return
      const container = scrollContainerRef.current
      if (container) {
        const timelineCenter = Math.max(
          0,
          container.scrollLeft +
            Math.max(0, container.clientWidth - labelWidth) / 2
        )
        pendingAnchorDateRef.current = dateKey(
          addDays(
            dateFromKey(range.start),
            Math.round(timelineCenter / range.dayWidth)
          )
        )
      }
      setViewMode(nextMode)
    },
    [range, viewMode]
  )

  React.useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return
      const pageSize = Math.max(container.clientWidth, container.clientHeight)
      const rawDeltaX =
        event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
      const rawDeltaY =
        event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY
      const locked = lockWheelToDominantAxis(
        normalizeWheelDelta(rawDeltaX, event.deltaMode, pageSize),
        normalizeWheelDelta(rawDeltaY, event.deltaMode, pageSize)
      )
      if (locked.deltaX === 0 && locked.deltaY === 0) return

      event.preventDefault()
      container.scrollBy({
        left: locked.deltaX,
        top: locked.deltaY,
        behavior: "auto",
      })
    }

    container.addEventListener("wheel", handleWheel, { passive: false })
    return () => container.removeEventListener("wheel", handleWheel)
  }, [])

  React.useEffect(() => {
    const anchorDate = pendingAnchorDateRef.current
    if (anchorDate) {
      pendingAnchorDateRef.current = null
      requestAnimationFrame(() => scrollToDate(anchorDate, "auto"))
      return
    }
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true
      requestAnimationFrame(() => scrollToDate(today, "auto"))
    }
  }, [scrollToDate, today])

  React.useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const updateHorizontalScroll = () => {
      setHorizontalScroll({
        value: container.scrollLeft,
        maximum: Math.max(0, container.scrollWidth - container.clientWidth),
      })
    }
    const resizeObserver = new ResizeObserver(updateHorizontalScroll)
    resizeObserver.observe(container)
    const content = container.firstElementChild
    if (content) resizeObserver.observe(content)
    container.addEventListener("scroll", updateHorizontalScroll, {
      passive: true,
    })
    requestAnimationFrame(updateHorizontalScroll)

    return () => {
      resizeObserver.disconnect()
      container.removeEventListener("scroll", updateHorizontalScroll)
    }
  }, [items.length, range.chartWidth])

  const scrollToItem = React.useCallback(
    (item: AudienceScheduleItem) => {
      const duration = Math.max(
        0,
        daysBetween(item.startDate, item.endDate)
      )
      const midpoint = dateKey(
        addDays(dateFromKey(item.startDate), Math.floor(duration / 2))
      )
      setSelectedItemId(item.id)
      scrollToDate(midpoint)
    },
    [scrollToDate]
  )

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/15 px-4 py-2">
        <div
          className="flex items-center border bg-background"
          aria-label="Gantt scale"
        >
          {GANTT_VIEW_MODES.map((mode, index) => (
            <Button
              key={mode}
              type="button"
              variant={viewMode === mode ? "secondary" : "ghost"}
              size="sm"
              className={cn("h-8 rounded-none", index > 0 && "border-l")}
              aria-pressed={viewMode === mode}
              onClick={() => handleViewModeChange(mode)}
            >
              {mode}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => scrollToDate(today)}
        >
          Today
        </Button>
      </div>
      <div
        ref={scrollContainerRef}
        className="max-h-[34rem] overflow-scroll overscroll-contain [scrollbar-gutter:stable_both-edges]"
        aria-label="Read-only project Gantt chart"
      >
        <div
          className="relative"
          style={{ minWidth: labelWidth + range.chartWidth }}
        >
          <div className="sticky top-0 z-20 flex h-14 border-b bg-background">
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
              {upperSegments.map((segment) => (
                <div
                  key={segment.key}
                  className="absolute inset-x-auto top-0 h-7 truncate border-r px-2 py-1.5 text-xs font-medium text-muted-foreground"
                  style={{ left: segment.left, width: segment.width }}
                >
                  {segment.label}
                </div>
              ))}
              {ticks.map((tick) => (
                <div
                  key={tick.key}
                  className="absolute bottom-0 h-7 truncate border-r border-t px-1 py-1.5 text-center text-[10px] tabular-nums text-muted-foreground"
                  style={{ left: tick.left, width: tick.width }}
                >
                  {tick.label}
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
                <button
                  type="button"
                  className={cn(
                    "sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r bg-background px-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
                    selectedItemId === item.id && "bg-accent"
                  )}
                  style={{ width: labelWidth }}
                  aria-label={`Show ${item.title} on the timeline`}
                  aria-pressed={selectedItemId === item.id}
                  onClick={() => scrollToItem(item)}
                >
                  <span className="truncate text-xs font-medium">
                    {item.title}
                  </span>
                  <span className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {formatDate(item.startDate)} – {formatDate(item.endDate)}
                  </span>
                </button>
                <div
                  className="relative shrink-0"
                  style={{
                    width: range.chartWidth,
                    backgroundImage:
                      "linear-gradient(to right, transparent calc(100% - 1px), var(--border) calc(100% - 1px))",
                    backgroundSize: `${range.dayWidth}px 100%`,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 z-10 w-px bg-destructive/60"
                    style={{
                      left:
                        daysBetween(range.start, today) * range.dayWidth +
                        range.dayWidth / 2,
                    }}
                  />
                  <div
                    className={cn(
                      "absolute top-3 h-8 overflow-hidden rounded-sm border border-primary/30 bg-primary/15 transition-shadow",
                      selectedItemId === item.id &&
                        "ring-2 ring-primary ring-offset-1"
                    )}
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
      <div className="flex items-center gap-3 border-t bg-background px-3 py-2">
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
          Timeline
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, horizontalScroll.maximum)}
          step={1}
          value={Math.min(
            horizontalScroll.value,
            Math.max(1, horizontalScroll.maximum)
          )}
          disabled={horizontalScroll.maximum === 0}
          aria-label="Scroll Gantt timeline horizontally"
          className="h-2 w-full cursor-ew-resize accent-primary disabled:cursor-default disabled:opacity-40"
          onChange={(event) => {
            const container = scrollContainerRef.current
            if (!container) return
            container.scrollLeft = Number(event.currentTarget.value)
          }}
        />
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Badge
                  variant={item.percentComplete === 100 ? "secondary" : "outline"}
                >
                  {item.percentComplete === 100
                    ? "Complete"
                    : item.isMilestone
                      ? "Milestone"
                      : `${item.percentComplete}%`}
                </Badge>
                <ScheduleConfirmationControl item={item} />
              </div>
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
