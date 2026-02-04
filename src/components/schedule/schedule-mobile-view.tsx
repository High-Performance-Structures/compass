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
  isSameDay,
  parseISO,
} from "date-fns"
import { cn } from "@/lib/utils"
import type { ScheduleTaskData } from "@/lib/schedule/types"

interface ScheduleMobileViewProps {
  tasks: ScheduleTaskData[]
  exceptions?: unknown[]
  onTaskClick?: (task: ScheduleTaskData) => void
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]

function getTaskColor(task: ScheduleTaskData): string {
  if (task.status === "COMPLETE") return "bg-green-500"
  if (task.status === "IN_PROGRESS") return "bg-blue-500"
  if (task.status === "BLOCKED") return "bg-red-500"
  if (task.isCriticalPath) return "bg-orange-500"
  return "bg-muted-foreground"
}

function getTaskBorderColor(task: ScheduleTaskData): string {
  if (task.status === "COMPLETE") return "border-green-500"
  if (task.status === "IN_PROGRESS") return "border-blue-500"
  if (task.status === "BLOCKED") return "border-red-500"
  if (task.isCriticalPath) return "border-orange-500"
  return "border-muted-foreground"
}

export function ScheduleMobileView({
  tasks,
  exceptions,
  onTaskClick,
}: ScheduleMobileViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(new Date())

  const currentMonth = currentDate.getMonth()
  const currentYear = currentDate.getFullYear()

  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const calendarStart = startOfWeek(monthStart)
  const calendarEnd = endOfWeek(monthEnd)

  const days = useMemo(
    () => eachDayOfInterval({ start: calendarStart, end: calendarEnd }),
    [calendarStart.getTime(), calendarEnd.getTime()]
  )

  const tasksByDate = useMemo(() => {
    const map = new Map<string, ScheduleTaskData[]>()
    for (const task of tasks) {
      const start = parseISO(task.startDate)
      const end = parseISO(task.endDateCalculated)
      const interval = eachDayOfInterval({ start, end })
      for (const day of interval) {
        const key = format(day, "yyyy-MM-dd")
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(task)
      }
    }
    return map
  }, [tasks])

  const selectedDayTasks = useMemo(() => {
    const key = format(selectedDate, "yyyy-MM-dd")
    return tasksByDate.get(key) || []
  }, [selectedDate, tasksByDate])

  const handleMonthSelect = (monthIndex: number) => {
    const newDate = new Date(currentYear, monthIndex, 1)
    setCurrentDate(newDate)
  }

  return (
    <div className="flex h-full flex-col">
      {/* month pill navigation */}
      <div className="flex gap-2 overflow-x-auto border-b px-4 py-2 [&::-webkit-scrollbar]:hidden">
        {MONTHS.map((month, i) => (
          <button
            key={month}
            className={cn(
              "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              i === currentMonth
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground active:bg-muted/80"
            )}
            onClick={() => handleMonthSelect(i)}
          >
            {month}
          </button>
        ))}
      </div>

      {/* year + nav */}
      <div className="flex items-center justify-between px-4 py-2">
        <button
          className="p-1 text-muted-foreground active:text-foreground"
          onClick={() => setCurrentDate(subMonths(currentDate, 1))}
        >
          &larr;
        </button>
        <span className="text-sm font-medium">
          {format(currentDate, "MMMM yyyy")}
        </span>
        <button
          className="p-1 text-muted-foreground active:text-foreground"
          onClick={() => setCurrentDate(addMonths(currentDate, 1))}
        >
          &rarr;
        </button>
      </div>

      {/* weekday header */}
      <div className="grid grid-cols-7 border-b text-center">
        {WEEKDAYS.map((day, i) => (
          <div
            key={`${day}-${i}`}
            className="bg-background py-2 text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* day cells */}
      <div className="grid grid-cols-7 gap-px bg-border">
        {days.map((day) => {
          const dateKey = format(day, "yyyy-MM-dd")
          const dayTasks = tasksByDate.get(dateKey) || []
          const inMonth = isSameMonth(day, currentDate)
          const selected = isSameDay(day, selectedDate)
          const today = isToday(day)

          return (
            <button
              key={dateKey}
              className={cn(
                "relative bg-background p-2 text-sm min-h-[44px]",
                !inMonth && "text-muted-foreground/40",
                selected && "bg-primary/10",
              )}
              onClick={() => setSelectedDate(day)}
            >
              <span
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-full text-xs",
                  today && "bg-primary text-primary-foreground font-bold",
                  selected && !today && "ring-2 ring-primary",
                )}
              >
                {format(day, "d")}
              </span>
              {dayTasks.length > 0 && (
                <div className="mt-0.5 flex justify-center gap-0.5">
                  {dayTasks.slice(0, 3).map((task, i) => (
                    <span
                      key={`${task.id}-${i}`}
                      className={cn("size-1 rounded-full", getTaskColor(task))}
                    />
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* selected day events */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="mb-2 text-sm font-semibold">
          {format(selectedDate, "EEE, MMM d")}
        </h3>
        {selectedDayTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks scheduled</p>
        ) : (
          <div className="space-y-2">
            {selectedDayTasks.map((task) => (
              <button
                key={task.id}
                className={cn(
                  "flex w-full gap-3 border-l-2 pl-3 py-2 text-left active:bg-muted/50 rounded-r-md",
                  getTaskBorderColor(task)
                )}
                onClick={() => onTaskClick?.(task)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{task.phase}</span>
                    <span>·</span>
                    <span>{task.percentComplete}% complete</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
