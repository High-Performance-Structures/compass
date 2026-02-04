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
  isSameDay,
  parseISO,
  isWithinInterval,
} from "date-fns"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react"
import type {
  ScheduleTaskData,
  WorkdayExceptionData,
} from "@/lib/schedule/types"

interface ScheduleCalendarViewProps {
  projectId: string
  tasks: ScheduleTaskData[]
  exceptions: WorkdayExceptionData[]
}

function isExceptionDay(
  date: Date,
  exceptions: WorkdayExceptionData[]
): boolean {
  return exceptions.some((ex) => {
    const start = parseISO(ex.startDate)
    const end = parseISO(ex.endDate)
    return isWithinInterval(date, { start, end })
  })
}

function getTaskColor(task: ScheduleTaskData): string {
  if (task.status === "COMPLETE") return "bg-green-500"
  if (task.status === "IN_PROGRESS") return "bg-blue-500"
  if (task.status === "BLOCKED") return "bg-red-500"
  if (task.isCriticalPath) return "bg-orange-500"
  return "bg-gray-400"
}

const MAX_VISIBLE_TASKS = 3

export function ScheduleCalendarView({
  tasks,
  exceptions,
}: ScheduleCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [expandedCells, setExpandedCells] = useState<Set<string>>(
    new Set()
  )

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
      const key = task.startDate
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(task)
    }
    return map
  }, [tasks])

  const toggleExpand = (dateKey: string) => {
    setExpandedCells((prev) => {
      const next = new Set(prev)
      if (next.has(dateKey)) {
        next.delete(dateKey)
      } else {
        next.add(dateKey)
      }
      return next
    })
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date())}
            className="h-9"
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => setCurrentDate(subMonths(currentDate, 1))}
          >
            <IconChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => setCurrentDate(addMonths(currentDate, 1))}
          >
            <IconChevronRight className="size-4" />
          </Button>
          <h2 className="text-base sm:text-lg font-medium whitespace-nowrap">
            {format(currentDate, "MMMM yyyy")}
          </h2>
        </div>
        <Select defaultValue="month">
          <SelectTrigger className="h-9 w-28 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">Month</SelectItem>
            <SelectItem value="day">Day</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-md overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="grid grid-cols-7 border-b">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
            (day) => (
              <div
                key={day}
                className="text-center text-xs font-medium text-muted-foreground py-2 border-r last:border-r-0"
              >
                {day}
              </div>
            )
          )}
        </div>

        <div className="grid grid-cols-7 flex-1">
          {days.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd")
            const dayTasks = tasksByDate.get(dateKey) || []
            const isNonWork =
              isWeekend(day) || isExceptionDay(day, exceptions)
            const inMonth = isSameMonth(day, currentDate)
            const expanded = expandedCells.has(dateKey)
            const visibleTasks = expanded
              ? dayTasks
              : dayTasks.slice(0, MAX_VISIBLE_TASKS)
            const overflow = dayTasks.length - MAX_VISIBLE_TASKS

            return (
              <div
                key={dateKey}
                className={`min-h-[60px] sm:min-h-[80px] border-r border-b last:border-r-0 p-1 sm:p-1.5 ${
                  !inMonth ? "bg-muted/30" : ""
                } ${isNonWork ? "bg-muted/50" : ""}`}
              >
                <div className="flex items-start justify-between mb-0.5 min-w-0">
                  <span
                    className={`text-xs shrink-0 ${
                      isToday(day)
                        ? "bg-primary text-primary-foreground rounded-full size-5 sm:size-6 flex items-center justify-center font-bold"
                        : inMonth
                          ? "text-foreground"
                          : "text-muted-foreground"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  {isNonWork && (
                    <span className="text-[8px] sm:text-[9px] text-muted-foreground truncate ml-1">
                      <span className="hidden sm:inline">Non-workday</span>
                      <span className="sm:hidden">Off</span>
                    </span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {visibleTasks.map((task) => (
                    <div
                      key={task.id}
                      className={`${getTaskColor(task)} text-white text-[9px] sm:text-[10px] px-1 py-0.5 rounded truncate`}
                      title={task.title}
                    >
                      {task.title.length > 15 ? `${task.title.slice(0, 12)}...` : task.title}
                    </div>
                  ))}
                  {!expanded && overflow > 0 && (
                    <button
                      className="text-[9px] sm:text-[10px] text-primary hover:underline"
                      onClick={() => toggleExpand(dateKey)}
                    >
                      +{overflow}
                    </button>
                  )}
                  {expanded && dayTasks.length > MAX_VISIBLE_TASKS && (
                    <button
                      className="text-[9px] sm:text-[10px] text-primary hover:underline"
                      onClick={() => toggleExpand(dateKey)}
                    >
                      Less
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
