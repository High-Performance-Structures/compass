"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns"
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconList,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useScheduleDisplayPalette } from "@/hooks/use-schedule-display-palette"
import { getScheduleItemDisplayColor } from "@/lib/schedule/appearance"
import { isNonWorkday } from "@/lib/schedule/business-days"
import { effectivePercentComplete } from "@/lib/schedule/progress"
import {
  projectScheduleLabel,
  type ScheduleProjectData,
} from "@/lib/schedule/project-scope"
import type {
  ScheduleTaskData,
  WorkdayExceptionData,
} from "@/lib/schedule/types"

type CalendarMode = "month" | "week" | "day" | "agenda"

interface ScheduleCalendarViewProps {
  readonly projectId: string
  readonly tasks: readonly ScheduleTaskData[]
  readonly exceptions: readonly WorkdayExceptionData[]
  readonly projects?: readonly ScheduleProjectData[]
}

function taskIncludesDay(task: ScheduleTaskData, day: Date): boolean {
  const start = parseISO(task.startDate)
  const end = parseISO(task.endDateCalculated)
  return day >= start && day <= end
}

function taskHref(task: ScheduleTaskData): string {
  return `/dashboard/projects/${encodeURIComponent(task.projectId)}/schedule?view=list&item=${encodeURIComponent(task.id)}#schedule-item-${encodeURIComponent(task.id)}`
}

function dateRangeLabel(mode: CalendarMode, date: Date): string {
  if (mode === "month") return format(date, "MMMM yyyy")
  if (mode === "week") {
    const start = startOfWeek(date)
    const end = endOfWeek(date)
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`
  }
  if (mode === "day") return format(date, "EEEE, MMMM d, yyyy")
  return "Schedule agenda"
}

function ProjectIdentity({
  project,
}: {
  readonly project: ScheduleProjectData
}): React.ReactElement {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1"
      title={projectScheduleLabel(project)}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: project.color }}
      />
      <span className="truncate">
        {project.projectNumber ?? project.name}
      </span>
    </span>
  )
}

function ScheduleTaskCard({
  task,
  project,
  color,
  compact = false,
  showProject,
}: {
  readonly task: ScheduleTaskData
  readonly project: ScheduleProjectData | null
  readonly color: string
  readonly compact?: boolean
  readonly showProject: boolean
}): React.ReactElement {
  const percent = effectivePercentComplete(task.status, task.percentComplete)

  return (
    <Link
      href={taskHref(task)}
      className={cn(
        "block min-w-0 border-l-[3px] bg-card transition-colors hover:bg-accent",
        compact ? "px-1.5 py-1" : "rounded-r-md border-y border-r px-3 py-2"
      )}
      style={{ borderLeftColor: color }}
      title={`${task.title} — ${percent}% complete`}
    >
      {showProject && project && (
        <span className="mb-0.5 block truncate text-[10px] font-medium text-muted-foreground">
          <ProjectIdentity project={project} />
        </span>
      )}
      <span
        className={cn(
          "block truncate font-medium",
          compact ? "text-[10px]" : "text-sm"
        )}
      >
        {task.title}
      </span>
      {!compact && (
        <span className="mt-1 block text-xs text-muted-foreground">
          {format(parseISO(task.startDate), "MMM d")} –{" "}
          {format(parseISO(task.endDateCalculated), "MMM d")} · {percent}%
        </span>
      )}
    </Link>
  )
}

export function ScheduleCalendarView({
  projectId,
  tasks,
  exceptions,
  projects = [],
}: ScheduleCalendarViewProps): React.ReactElement {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [mode, setMode] = useState<CalendarMode>("month")
  const [expandedDay, setExpandedDay] = useState<Date | null>(null)
  const displayColorPalette = useScheduleDisplayPalette(projectId)
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )
  const multipleProjects = projectById.size > 1
  const sortedTasks = useMemo(
    () =>
      [...tasks].sort(
        (left, right) =>
          left.startDate.localeCompare(right.startDate) ||
          left.endDateCalculated.localeCompare(right.endDateCalculated) ||
          left.title.localeCompare(right.title)
      ),
    [tasks]
  )
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate))
    const end = endOfWeek(endOfMonth(currentDate))
    return eachDayOfInterval({ start, end })
  }, [currentDate])
  const weekDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(currentDate),
        end: endOfWeek(currentDate),
      }),
    [currentDate]
  )
  const agendaGroups = useMemo(() => {
    const groups = new Map<string, ScheduleTaskData[]>()
    for (const task of sortedTasks) {
      const current = groups.get(task.startDate) ?? []
      current.push(task)
      groups.set(task.startDate, current)
    }
    return [...groups]
  }, [sortedTasks])

  function colorFor(task: ScheduleTaskData): string {
    const project = projectById.get(task.projectId)
    return multipleProjects && project
      ? project.color
      : getScheduleItemDisplayColor(task, displayColorPalette)
  }

  function tasksForDay(day: Date): readonly ScheduleTaskData[] {
    return sortedTasks.filter((task) => taskIncludesDay(task, day))
  }

  function navigate(direction: -1 | 1): void {
    setExpandedDay(null)
    setCurrentDate((date) => {
      if (mode === "month") {
        return direction === 1 ? addMonths(date, 1) : subMonths(date, 1)
      }
      if (mode === "week") {
        return direction === 1 ? addWeeks(date, 1) : subWeeks(date, 1)
      }
      return direction === 1 ? addDays(date, 1) : subDays(date, 1)
    })
  }

  function nonWorkday(day: Date): boolean {
    return !multipleProjects && isNonWorkday(day, exceptions)
  }

  const expandedTasks = expandedDay ? tasksForDay(expandedDay) : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {mode !== "agenda" && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentDate(new Date())}
              className="h-8 text-xs"
            >
              Today
            </Button>
            <div className="flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => navigate(-1)}
                aria-label={`Previous ${mode}`}
              >
                <IconChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => navigate(1)}
                aria-label={`Next ${mode}`}
              >
                <IconChevronRight className="size-4" />
              </Button>
            </div>
          </>
        )}
        <h2 className="min-w-[180px] text-sm font-medium">
          {dateRangeLabel(mode, currentDate)}
        </h2>
        <div
          className="ml-auto inline-flex overflow-hidden rounded-md border"
          role="group"
          aria-label="Schedule calendar view"
        >
          {(
            [
              ["month", "Month", IconCalendar],
              ["week", "Week", IconCalendar],
              ["day", "Day", IconCalendar],
              ["agenda", "Agenda", IconList],
            ] as const
          ).map(([value, label, Icon]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-8 rounded-none border-r px-2.5 text-xs last:border-r-0",
                mode === value && "bg-secondary text-secondary-foreground"
              )}
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </Button>
          ))}
        </div>
      </div>

      {mode === "month" && (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <div className="grid min-w-[760px] grid-cols-7 border-b bg-muted/30">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
              (day) => (
                <div
                  key={day}
                  className="border-r py-1.5 text-center text-[11px] font-medium text-muted-foreground last:border-r-0"
                >
                  {day}
                </div>
              )
            )}
          </div>
          <div className="grid min-w-[760px] grid-cols-7">
            {monthDays.map((day) => {
              const dayTasks = tasksForDay(day)
              return (
                <div
                  key={format(day, "yyyy-MM-dd")}
                  className={cn(
                    "min-h-[112px] border-b border-r p-1.5",
                    !isSameMonth(day, currentDate) && "bg-muted/20",
                    nonWorkday(day) && "bg-muted/35"
                  )}
                >
                  <span
                    className={cn(
                      "mb-1 inline-flex size-5 items-center justify-center rounded-full text-[11px]",
                      isToday(day)
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  <div className="space-y-1">
                    {dayTasks.slice(0, 3).map((task) => (
                      <ScheduleTaskCard
                        key={task.id}
                        task={task}
                        project={projectById.get(task.projectId) ?? null}
                        color={colorFor(task)}
                        compact
                        showProject={multipleProjects}
                      />
                    ))}
                    {dayTasks.length > 3 && (
                      <button
                        type="button"
                        className="w-full px-1 text-left text-[10px] font-medium text-primary hover:underline"
                        onClick={() => setExpandedDay(day)}
                      >
                        +{dayTasks.length - 3} more
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {mode === "week" && (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto rounded-md border sm:grid-cols-7">
          {weekDays.map((day) => {
            const dayTasks = tasksForDay(day)
            return (
              <section
                key={format(day, "yyyy-MM-dd")}
                className={cn(
                  "min-h-[180px] border-b p-2 sm:border-b-0 sm:border-r sm:last:border-r-0",
                  nonWorkday(day) && "bg-muted/35"
                )}
              >
                <button
                  type="button"
                  className="mb-2 flex w-full items-center justify-between text-left"
                  onClick={() => {
                    setCurrentDate(day)
                    setMode("day")
                  }}
                >
                  <span className="text-xs font-medium">
                    {format(day, "EEE")}
                  </span>
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full text-xs",
                      isToday(day) &&
                        "bg-primary font-semibold text-primary-foreground"
                    )}
                  >
                    {format(day, "d")}
                  </span>
                </button>
                <div className="space-y-1.5">
                  {dayTasks.map((task) => (
                    <ScheduleTaskCard
                      key={task.id}
                      task={task}
                      project={projectById.get(task.projectId) ?? null}
                      color={colorFor(task)}
                      compact
                      showProject={multipleProjects}
                    />
                  ))}
                  {dayTasks.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">No items</p>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {mode === "day" && (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border p-3">
          <div className="mx-auto max-w-3xl space-y-2">
            {tasksForDay(currentDate).map((task) => (
              <ScheduleTaskCard
                key={task.id}
                task={task}
                project={projectById.get(task.projectId) ?? null}
                color={colorFor(task)}
                showProject={multipleProjects}
              />
            ))}
            {tasksForDay(currentDate).length === 0 && (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No schedule items on this day.
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "agenda" && (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <div className="divide-y">
            {agendaGroups.map(([date, groupedTasks]) => (
              <section
                key={date}
                className="grid gap-3 p-3 sm:grid-cols-[9rem_minmax(0,1fr)]"
              >
                <div>
                  <p className="text-sm font-medium">
                    {format(parseISO(date), "EEE, MMM d")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {groupedTasks.length} item
                    {groupedTasks.length === 1 ? "" : "s"} starting
                  </p>
                </div>
                <div className="space-y-2">
                  {groupedTasks.map((task) => (
                    <ScheduleTaskCard
                      key={task.id}
                      task={task}
                      project={projectById.get(task.projectId) ?? null}
                      color={colorFor(task)}
                      showProject={multipleProjects}
                    />
                  ))}
                </div>
              </section>
            ))}
            {agendaGroups.length === 0 && (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No schedule items match the current scope and filters.
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={expandedDay !== null}
        onOpenChange={(open) => {
          if (!open) setExpandedDay(null)
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {expandedDay ? format(expandedDay, "EEEE, MMMM d, yyyy") : "Day"}
            </DialogTitle>
            <DialogDescription>
              All schedule items active on this date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {expandedTasks.map((task) => (
              <ScheduleTaskCard
                key={task.id}
                task={task}
                project={projectById.get(task.projectId) ?? null}
                color={colorFor(task)}
                showProject={multipleProjects}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
