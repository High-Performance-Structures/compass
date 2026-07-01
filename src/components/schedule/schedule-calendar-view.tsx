"use client"

import { useState, useMemo } from "react"
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  addMonths,
  subMonths,
  isToday,
  isSameMonth,
  isWeekend,
  parseISO,
  isWithinInterval,
  differenceInCalendarDays,
} from "date-fns"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react"
import type {
  ScheduleTaskData,
  WorkdayExceptionData,
} from "@/lib/schedule/types"

interface ScheduleCalendarViewProps {
  readonly projectId: string
  readonly tasks: readonly ScheduleTaskData[]
  readonly exceptions: readonly WorkdayExceptionData[]
}

// How many task lanes to show before "+N more"
const MAX_LANES = 3
const LANE_HEIGHT = 22
const DAY_HEADER_HEIGHT = 24

function isExceptionDay(
  date: Date,
  exceptions: readonly WorkdayExceptionData[]
): boolean {
  return exceptions.some((ex) => {
    const start = parseISO(ex.startDate)
    const end = parseISO(ex.endDate)
    return isWithinInterval(date, { start, end })
  })
}

function getTaskColor(task: ScheduleTaskData): string {
  if (task.status === "COMPLETE") return "bg-[#3f7d4d] dark:bg-[#3f7d4d]"
  if (task.status === "IN_PROGRESS") return "bg-[#2f5963] dark:bg-[#2f5963]"
  if (task.status === "BLOCKED") return "bg-destructive"
  if (task.isCriticalPath) return "bg-[#9d832c]"
  return "bg-muted-foreground/75"
}

interface WeekTask {
  readonly task: ScheduleTaskData
  readonly startCol: number
  readonly span: number
  readonly lane: number
  readonly isStart: boolean
  readonly isEnd: boolean
}

interface WeekRow {
  readonly days: readonly Date[]
  readonly tasks: WeekTask[]
  readonly maxLane: number
  readonly overflowByDay: readonly number[]
}

function buildWeekRows(
  calendarDays: readonly Date[],
  tasks: readonly ScheduleTaskData[]
): WeekRow[] {
  const weeks: {
    days: Date[]
    tasks: {
      task: ScheduleTaskData
      startCol: number
      span: number
      lane: number
      isStart: boolean
      isEnd: boolean
    }[]
  }[] = []

  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push({
      days: calendarDays.slice(i, i + 7) as Date[],
      tasks: [],
    })
  }

  // Place each task into the weeks it overlaps
  for (const task of tasks) {
    const taskStart = parseISO(task.startDate)
    const taskEnd = parseISO(task.endDateCalculated)

    for (const week of weeks) {
      const weekStart = week.days[0]
      const weekEnd = week.days[6]

      // Check overlap: task must start on or before weekEnd,
      // and end on or after weekStart
      if (taskStart > weekEnd || taskEnd < weekStart) continue

      const startCol = Math.max(
        0,
        differenceInCalendarDays(taskStart, weekStart)
      )
      const endCol = Math.min(
        6,
        differenceInCalendarDays(taskEnd, weekStart)
      )
      const span = endCol - startCol + 1

      week.tasks.push({
        task,
        startCol,
        span,
        lane: 0,
        isStart: taskStart >= weekStart,
        isEnd: taskEnd <= weekEnd,
      })
    }
  }

  // Assign lanes using first-fit
  return weeks.map((week) => {
    // Sort: earlier start first, then longer tasks first (they anchor better)
    week.tasks.sort(
      (a, b) => a.startCol - b.startCol || b.span - a.span
    )

    const lanes: boolean[][] = []
    for (const wt of week.tasks) {
      let lane = 0
      while (true) {
        if (!lanes[lane]) lanes[lane] = Array(7).fill(false) as boolean[]
        const cols = lanes[lane].slice(wt.startCol, wt.startCol + wt.span)
        if (cols.every((occupied) => !occupied)) break
        lane++
      }
      wt.lane = lane
      if (!lanes[lane]) lanes[lane] = Array(7).fill(false) as boolean[]
      for (let c = wt.startCol; c < wt.startCol + wt.span; c++) {
        lanes[lane][c] = true
      }
    }

    // Count overflow per day (tasks in lanes >= MAX_LANES)
    const overflowByDay = Array(7).fill(0) as number[]
    for (const wt of week.tasks) {
      if (wt.lane >= MAX_LANES) {
        for (let c = wt.startCol; c < wt.startCol + wt.span; c++) {
          overflowByDay[c]++
        }
      }
    }

    const maxLane = week.tasks.reduce(
      (max, wt) => Math.max(max, wt.lane),
      -1
    )

    return {
      days: week.days,
      tasks: week.tasks,
      maxLane: Math.min(maxLane, MAX_LANES - 1),
      overflowByDay,
    }
  })
}

export function ScheduleCalendarView({
  tasks,
  exceptions,
}: ScheduleCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())

  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const calendarStart = startOfWeek(monthStart)
  const calendarEnd = endOfWeek(monthEnd)

  const calendarDays = useMemo(
    () => eachDayOfInterval({ start: calendarStart, end: calendarEnd }),
    [calendarStart.getTime(), calendarEnd.getTime()]
  )

  const weekRows = useMemo(
    () => buildWeekRows(calendarDays, tasks),
    [calendarDays, tasks]
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Calendar controls */}
      <div className="flex items-center gap-2 mb-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentDate(new Date())}
          className="h-8 text-xs"
        >
          Today
        </Button>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setCurrentDate(subMonths(currentDate, 1))}
          >
            <IconChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setCurrentDate(addMonths(currentDate, 1))}
          >
            <IconChevronRight className="size-4" />
          </Button>
        </div>
        <h2 className="text-sm font-medium">
          {format(currentDate, "MMMM yyyy")}
        </h2>
      </div>

      {/* Calendar grid */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b bg-muted/20">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div
              key={day}
              className="text-center text-[11px] font-medium text-muted-foreground py-1.5 border-r last:border-r-0"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Week rows */}
        <div className="flex flex-col flex-1 min-h-0">
          {weekRows.map((week, weekIdx) => {
            const visibleLanes = Math.min(week.maxLane + 1, MAX_LANES)
            const contentHeight = DAY_HEADER_HEIGHT + visibleLanes * LANE_HEIGHT
            const hasOverflow = week.overflowByDay.some((n) => n > 0)
            const totalHeight = contentHeight + (hasOverflow ? 16 : 0)

            return (
              <div
                key={weekIdx}
                className="relative border-b last:border-b-0 flex-1"
                style={{ minHeight: `${Math.max(totalHeight, 60)}px` }}
              >
                {/* Day cells (background + day numbers) */}
                <div className="grid grid-cols-7 absolute inset-0">
                  {week.days.map((day) => {
                    const inMonth = isSameMonth(day, currentDate)
                    const isNonWork =
                      isWeekend(day) || isExceptionDay(day, exceptions)

                    return (
                      <div
                        key={format(day, "yyyy-MM-dd")}
                        className={cn(
                          "border-r p-1 last:border-r-0",
                          !inMonth && "bg-muted/15",
                          isNonWork && inMonth && "bg-muted/30",
                        )}
                      >
                        <span
                          className={cn(
                            "text-[11px] leading-none",
                            isToday(day)
                              ? "inline-flex size-5 items-center justify-center rounded-sm bg-primary text-primary-foreground font-bold"
                              : inMonth
                                ? "text-foreground/80"
                                : "text-muted-foreground/50",
                          )}
                        >
                          {format(day, "d")}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Task bars (overlaid) */}
                {week.tasks
                  .filter((wt) => wt.lane < MAX_LANES)
                  .map((wt) => (
                    <div
                      key={`${wt.task.id}-${weekIdx}`}
                      className={cn(
                        "absolute text-[10px] text-white font-medium truncate px-1.5 leading-[20px] cursor-default",
                        getTaskColor(wt.task),
                        wt.isStart && wt.isEnd && "rounded-[2px]",
                        wt.isStart && !wt.isEnd && "rounded-l-[2px]",
                        !wt.isStart && wt.isEnd && "rounded-r-[2px]",
                        !wt.isStart && !wt.isEnd && "rounded-none",
                      )}
                      style={{
                        top: `${DAY_HEADER_HEIGHT + wt.lane * LANE_HEIGHT}px`,
                        left: `${(wt.startCol / 7) * 100}%`,
                        width: `${(wt.span / 7) * 100}%`,
                        height: `${LANE_HEIGHT - 2}px`,
                        paddingLeft: wt.isStart ? "6px" : "2px",
                      }}
                      title={`${wt.task.title} (${wt.task.startDate} - ${wt.task.endDateCalculated})`}
                    >
                      {wt.isStart ? wt.task.title : ""}
                    </div>
                  ))}

                {/* Overflow indicators */}
                {hasOverflow && (
                  <div
                    className="grid grid-cols-7 absolute left-0 right-0"
                    style={{ top: `${contentHeight}px` }}
                  >
                    {week.overflowByDay.map((count, dayIdx) => (
                      <div
                        key={dayIdx}
                        className="text-[10px] text-primary px-1 border-r last:border-r-0"
                      >
                        {count > 0 ? `+${count} more` : ""}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
