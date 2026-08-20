"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  IconCalendarEvent,
  IconCalendarMonth,
  IconCalendarPlus,
  IconCalendarWeek,
  IconChevronLeft,
  IconChevronRight,
  IconClipboardCheck,
  IconListDetails,
  IconMessageQuestion,
  IconReceipt,
  IconSearch,
} from "@tabler/icons-react"

import type {
  WorkCalendarEntry,
  WorkCalendarEntryKind,
  WorkCalendarData,
} from "@/app/actions/work-calendar"
import { Badge } from "@/components/ui/badge"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { workCalendarEntryMatches } from "@/lib/work-calendar"
import { WorkCalendarEventDialog } from "./work-calendar-event-dialog"
import { WorkCalendarTodoDialog } from "./work-calendar-todo-dialog"

export type WorkCalendarKindFilter = WorkCalendarEntryKind | "all"
export type WorkCalendarView = "today" | "week" | "month" | "list"
type CalendarEventEntry = Extract<WorkCalendarEntry, { kind: "event" }>

type KindConfig = {
  readonly id: WorkCalendarKindFilter
  readonly label: string
  readonly icon: React.ReactNode
}

const KIND_FILTERS: readonly KindConfig[] = [
  {
    id: "all",
    label: "All work",
    icon: <IconCalendarEvent className="size-4" />,
  },
  {
    id: "schedule",
    label: "Schedule items",
    icon: <IconCalendarEvent className="size-4" />,
  },
  {
    id: "event",
    label: "Events",
    icon: <IconCalendarPlus className="size-4" />,
  },
  {
    id: "task",
    label: "To-dos",
    icon: <IconClipboardCheck className="size-4" />,
  },
  {
    id: "rfi",
    label: "RFIs",
    icon: <IconMessageQuestion className="size-4" />,
  },
  {
    id: "purchase_order",
    label: "POs",
    icon: <IconReceipt className="size-4" />,
  },
]

const VIEW_OPTIONS: readonly {
  readonly id: WorkCalendarView
  readonly label: string
  readonly icon: React.ReactNode
}[] = [
  {
    id: "today",
    label: "Today",
    icon: <IconCalendarEvent className="size-4" />,
  },
  {
    id: "week",
    label: "Week",
    icon: <IconCalendarWeek className="size-4" />,
  },
  {
    id: "month",
    label: "Month",
    icon: <IconCalendarMonth className="size-4" />,
  },
  {
    id: "list",
    label: "List",
    icon: <IconListDetails className="size-4" />,
  },
]

function parseDateKey(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date)
  next.setDate(1)
  next.setMonth(next.getMonth() + months)
  return next
}

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function startOfWeek(date: Date): Date {
  const start = new Date(date)
  const day = start.getDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  start.setDate(start.getDate() - daysSinceMonday)
  return start
}

function monthCalendarDays(date: Date): readonly string[] {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
  const lastOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const gridStart = startOfWeek(firstOfMonth)
  const gridEnd = addDays(startOfWeek(lastOfMonth), 6)
  const length =
    Math.round(
      (gridEnd.getTime() - gridStart.getTime()) / (24 * 60 * 60 * 1000)
    ) + 1
  return Array.from({ length }, (_, index) =>
    toDateKey(addDays(gridStart, index))
  )
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parseDateKey(date))
}

function formatWeekday(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
  }).format(parseDateKey(date))
}

function formatFullDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parseDateKey(date))
}

function navigationUnit(view: WorkCalendarView): "day" | "week" | "month" {
  switch (view) {
    case "today":
      return "day"
    case "week":
      return "week"
    case "month":
    case "list":
      return "month"
  }
}

function kindLabel(kind: WorkCalendarEntryKind): string {
  switch (kind) {
    case "schedule":
      return "Schedule item"
    case "event":
      return "Event"
    case "task":
      return "To-do"
    case "rfi":
      return "RFI"
    case "purchase_order":
      return "PO"
  }
}

function kindTone(kind: WorkCalendarEntryKind): string {
  switch (kind) {
    case "schedule":
      return "border-brand-compass-blue bg-card text-brand-compass-blue"
    case "event":
      return "border-[#5f4b8b] bg-card text-[#5f4b8b]"
    case "task":
      return "border-brand-hps-primary bg-card text-brand-hps-primary"
    case "rfi":
      return "border-brand-nutech-gold bg-card text-brand-nutech-gold-foreground"
    case "purchase_order":
      return "border-brand-orc-brown bg-card text-brand-orc-brown"
  }
}

function compactKindTone(kind: WorkCalendarEntryKind): string {
  switch (kind) {
    case "schedule":
      return "border-l-[#2f5963]"
    case "event":
      return "border-l-[#5f4b8b]"
    case "task":
      return "border-l-[#3f7d4d]"
    case "rfi":
      return "border-l-[#9d832c]"
    case "purchase_order":
      return "border-l-[#6f471f]"
  }
}

function entryOnDay(entry: WorkCalendarEntry, date: string): boolean {
  return entry.startDate <= date && entry.endDate >= date
}

function WorkItem({
  entry,
  compact = false,
  focused = false,
  onEditEvent,
}: {
  readonly entry: WorkCalendarEntry
  readonly compact?: boolean
  readonly focused?: boolean
  readonly onEditEvent: (event: CalendarEventEntry) => void
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const className = cn(
    "block w-full rounded-lg border bg-background p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:bg-muted/60 hover:shadow-md",
    compact && "border-l-4 p-2",
    compact && compactKindTone(entry.kind),
    focused && "border-primary bg-primary/5 ring-2 ring-primary/30"
  )
  const contents = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("line-clamp-2 font-medium", compact ? "text-xs" : "text-sm")}>
            {entry.title}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {entry.projectLabel}
            {developerModeEnabled ? ` · ${entry.sourceLabel}` : ""}
          </p>
        </div>
        {!compact && (
          <Badge
            variant="outline"
            className={cn("shrink-0 border", kindTone(entry.kind))}
          >
            {kindLabel(entry.kind)}
          </Badge>
        )}
      </div>
      {!compact && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span>
            {formatShortDate(entry.startDate)}
            {entry.endDate !== entry.startDate
              ? ` - ${formatShortDate(entry.endDate)}`
              : ""}
          </span>
          <span>·</span>
          <span>{entry.status}</span>
          {entry.kind === "event" && (
            <>
              <span>·</span>
              <span>
                {entry.eventDetails.allDay
                  ? "All day"
                  : `${entry.eventDetails.startTime}–${entry.eventDetails.endTime}`}
              </span>
            </>
          )}
          {entry.kind === "event" && entry.eventDetails.location && (
            <>
              <span>·</span>
              <span className="truncate">{entry.eventDetails.location}</span>
            </>
          )}
          {(entry.assignedTo || entry.companyName) && (
            <>
              <span>·</span>
              <span>{entry.assignedTo ?? entry.companyName}</span>
            </>
          )}
        </div>
      )}
    </>
  )

  if (
    entry.kind === "event" &&
    entry.eventDetails.managed
  ) {
    return (
      <button
        id={compact ? undefined : `work-calendar-${entry.id}`}
        type="button"
        className={className}
        onClick={() => onEditEvent(entry)}
        aria-label={`Edit calendar event ${entry.title}`}
      >
        {contents}
      </button>
    )
  }

  return (
    <Link
      id={compact ? undefined : `work-calendar-${entry.id}`}
      href={entry.href}
      className={className}
    >
      {contents}
    </Link>
  )
}

export function WorkCalendar({
  data,
  initialKind = "all",
  initialItemId = null,
  initialView = "week",
  initialDate,
}: {
  readonly data: WorkCalendarData
  readonly initialKind?: WorkCalendarKindFilter
  readonly initialItemId?: string | null
  readonly initialView?: WorkCalendarView
  readonly initialDate?: string
}): React.ReactElement {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = React.useState("")
  const [editingEvent, setEditingEvent] =
    React.useState<CalendarEventEntry | null>(null)
  const [expandedDay, setExpandedDay] = React.useState<string | null>(null)
  const [activeKind, setActiveKind] =
    React.useState<WorkCalendarKindFilter>(initialKind)
  const [activeView, setActiveView] = React.useState<WorkCalendarView>(
    initialItemId ? "list" : initialView
  )
  const [activeDate, setActiveDate] = React.useState(
    initialDate ?? data.today
  )
  React.useEffect(() => {
    setActiveKind(initialKind)
  }, [initialKind])
  React.useEffect(() => {
    setActiveView(initialItemId ? "list" : initialView)
  }, [initialItemId, initialView])
  React.useEffect(() => {
    setActiveDate(initialDate ?? data.today)
  }, [data.today, initialDate])
  const calendarDate = React.useMemo(
    () => parseDateKey(activeDate),
    [activeDate]
  )
  const weekDays = React.useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        toDateKey(addDays(startOfWeek(calendarDate), index))
      ),
    [calendarDate]
  )
  const monthDays = React.useMemo(
    () => monthCalendarDays(calendarDate),
    [calendarDate]
  )
  const visibleCalendarDays =
    activeView === "today"
      ? [activeDate]
      : activeView === "month"
        ? monthDays
        : weekDays
  const filteredEntries = data.entries.filter(
    (entry) =>
      (activeKind === "all" || entry.kind === activeKind) &&
      workCalendarEntryMatches(entry, query)
  )
  const overdueEntries = filteredEntries.filter(
    (entry) => entry.endDate < data.today
  )
  const todayEntries = filteredEntries.filter((entry) =>
    entryOnDay(entry, data.today)
  )
  const activeDateEntries = filteredEntries.filter((entry) =>
    entryOnDay(entry, activeDate)
  )
  const expandedDayEntries = expandedDay
    ? filteredEntries.filter((entry) => entryOnDay(entry, expandedDay))
    : []
  const taskCount = filteredEntries.filter((entry) => entry.kind === "task").length
  const rfiCount = filteredEntries.filter((entry) => entry.kind === "rfi").length

  function navigateCalendar(direction: -1 | 1): void {
    const nextDate =
      activeView === "month"
        ? addMonths(calendarDate, direction)
        : addDays(calendarDate, direction * (activeView === "week" ? 7 : 1))
    const nextDateKey = toDateKey(nextDate)
    const params = new URLSearchParams(searchParams.toString())
    params.set("view", activeView)
    params.set("date", nextDateKey)
    if (activeKind === "all") {
      params.delete("kind")
    } else {
      params.set("kind", activeKind)
    }
    params.delete("item")
    setActiveDate(nextDateKey)
    setExpandedDay(null)
    router.replace(`/dashboard/schedule?${params.toString()}`, {
      scroll: false,
    })
  }

  function changePeopleFilter(value: string): void {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "me") params.delete("people")
    else params.set("people", value)
    params.delete("item")
    router.replace(`/dashboard/schedule?${params.toString()}`, { scroll: false })
  }

  React.useEffect(() => {
    if (!initialItemId) return
    document
      .getElementById(`work-calendar-${initialItemId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [initialItemId, activeView])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b bg-background">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 md:px-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex size-10 items-center justify-center rounded-md border border-brand-hps-primary bg-card text-brand-hps-primary">
                <IconCalendarEvent className="size-5" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                  Work calendar
                </p>
                <h1 className="text-2xl font-semibold tracking-tight">
                  To-dos, schedule items, and field follow-ups.
                </h1>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              A cross-project view of work that needs a person, a date, and a
              source record.
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 rounded-lg border bg-muted/30 p-3">
            <div>
              <p className="text-xs text-muted-foreground">Today</p>
              <p className="mt-1 text-2xl font-semibold">{todayEntries.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">To-dos</p>
              <p className="mt-1 text-2xl font-semibold">{taskCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">RFIs</p>
              <p className="mt-1 text-2xl font-semibold">{rfiCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Past due</p>
              <p className="mt-1 text-2xl font-semibold">{overdueEntries.length}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 md:px-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xl">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by to-do, project, assignee, RFI, PO..."
              className="pl-9"
            />
          </div>
          {data.googlePeople.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Google calendars</span>
              <Select
                value={data.activeGooglePeopleFilter}
                onValueChange={changePeopleFilter}
              >
                <SelectTrigger size="sm" className="w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="me">My Google calendars</SelectItem>
                  <SelectItem value="all">All staff availability</SelectItem>
                  {data.googlePeople.map((person) => (
                    <SelectItem key={person.userId} value={person.userId}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Other users' personal events are shown as Busy.
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/schedule?mode=projects&scope=all&view=gantt">
                Project schedules
              </Link>
            </Button>
            {data.canCreateEvents && (
              <WorkCalendarEventDialog
                variant="create"
                projects={data.projects}
                attendeeOptions={data.attendeeOptions}
                defaultProjectId={data.defaultProjectId}
                defaultTimeZone={data.defaultTimeZone}
                today={data.today}
                googleDestinations={data.googleDestinations}
              />
            )}
            {data.canCreateTodos && (
              <WorkCalendarTodoDialog
                projects={data.projects}
                defaultProjectId={data.defaultProjectId}
                today={data.today}
              />
            )}
            {KIND_FILTERS.map((filter) => (
              <Button
                key={filter.id}
                type="button"
                size="sm"
                variant={activeKind === filter.id ? "default" : "outline"}
                onClick={() => setActiveKind(filter.id)}
              >
                {filter.icon}
                {filter.label}
              </Button>
            ))}
          </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-y py-2">
            <div
              className="inline-flex overflow-hidden rounded-md border bg-background"
              role="group"
              aria-label="Work calendar view"
            >
              {VIEW_OPTIONS.map((view) => (
                <Button
                  key={view.id}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "rounded-none border-r last:border-r-0",
                    activeView === view.id && "bg-secondary text-secondary-foreground"
                  )}
                  onClick={() => setActiveView(view.id)}
                  aria-pressed={activeView === view.id}
                >
                  {view.icon}
                  {view.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {filteredEntries.length} work item
              {filteredEntries.length === 1 ? "" : "s"} match the current
              filters
            </p>
          </div>
        </div>

        {activeView !== "list" && (
        <section className="border-y bg-card py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => navigateCalendar(-1)}
                aria-label={`Previous ${navigationUnit(activeView)}`}
                title={`Previous ${navigationUnit(activeView)}`}
              >
                <IconChevronLeft className="size-4" />
              </Button>
              <div className="min-w-40 text-center sm:text-left">
                <h2
                  className="text-sm font-semibold"
                  data-testid="work-calendar-period-label"
                >
                  {activeView === "today"
                    ? activeDate === data.today
                      ? `Today · ${formatShortDate(activeDate)}`
                      : formatFullDate(activeDate)
                    : activeView === "week"
                      ? `Week of ${formatShortDate(weekDays[0] ?? data.today)}`
                      : new Intl.DateTimeFormat("en-US", {
                          month: "long",
                          year: "numeric",
                        }).format(calendarDate)}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Select any item to open its source record.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => navigateCalendar(1)}
                aria-label={`Next ${navigationUnit(activeView)}`}
                title={`Next ${navigationUnit(activeView)}`}
              >
                <IconChevronRight className="size-4" />
              </Button>
            </div>
            <Badge variant="secondary">
              {activeView === "today"
                ? `${activeDateEntries.length} item${
                    activeDateEntries.length === 1 ? "" : "s"
                  }`
                : activeView === "week"
                  ? "Monday–Sunday"
                  : `${visibleCalendarDays.length / 7} weeks`}
            </Badge>
          </div>

          <div
            className={cn(
              "mt-4 grid overflow-hidden border",
              activeView === "today"
                ? "grid-cols-1"
                : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-7"
            )}
          >
            {visibleCalendarDays.map((day) => {
              const dayEntries = filteredEntries.filter((entry) =>
                entryOnDay(entry, day)
              )
              const outsideCurrentMonth =
                activeView === "month" &&
                parseDateKey(day).getMonth() !== calendarDate.getMonth()

              return (
                <div
                  key={day}
                  className={cn(
                    "min-h-40 border-b border-r bg-muted/20 p-2 last:border-r-0",
                    activeView === "today" && "min-h-0",
                    outsideCurrentMonth && "bg-muted/50 text-muted-foreground"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold">{formatWeekday(day)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatShortDate(day)}
                      </p>
                    </div>
                    <Badge variant="outline">{dayEntries.length}</Badge>
                  </div>
                  <div className="mt-2 space-y-2">
                    {dayEntries
                      .slice(0, activeView === "today" ? 50 : 3)
                      .map((entry) => (
                      <WorkItem
                        key={`${day}-${entry.kind}-${entry.id}`}
                        entry={entry}
                        compact={activeView !== "today"}
                        focused={entry.id === initialItemId}
                        onEditEvent={setEditingEvent}
                      />
                    ))}
                    {activeView !== "today" && dayEntries.length > 3 && (
                      <button
                        type="button"
                        className="w-full px-1 py-1 text-left text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setExpandedDay(day)}
                        aria-label={`Show ${dayEntries.length - 3} more items for ${formatFullDate(day)}`}
                      >
                        +{dayEntries.length - 3} more
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
        )}

        {activeView === "list" && (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="border-y bg-card py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Work Queue</h2>
              <Badge variant="outline">{filteredEntries.length} items</Badge>
            </div>
            <div className="mt-4 grid gap-3">
              {filteredEntries.length > 0 ? (
                filteredEntries.slice(0, 50).map((entry) => (
                  <WorkItem
                    key={`${entry.kind}-${entry.id}`}
                    entry={entry}
                    focused={entry.id === initialItemId}
                    onEditEvent={setEditingEvent}
                  />
                ))
              ) : (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No work items match this view.
                </div>
              )}
            </div>
          </div>

          <aside className="border-y bg-card py-4">
            <h2 className="text-sm font-semibold">To-do Sources</h2>
            <div className="mt-3 grid gap-2">
              <Link
                href="/dashboard/projects/select?target=daily-logs"
                className="rounded-md border bg-background p-3 text-sm font-medium transition-colors hover:bg-muted/60"
              >
                Daily logs
              </Link>
              <Link
                href="/dashboard/projects/select?target=schedule"
                className="rounded-md border bg-background p-3 text-sm font-medium transition-colors hover:bg-muted/60"
              >
                Project schedules
              </Link>
              <Link
                href="/dashboard/rfis"
                className="rounded-md border bg-background p-3 text-sm font-medium transition-colors hover:bg-muted/60"
              >
                RFIs
              </Link>
              <Link
                href="/dashboard/purchase-orders"
                className="rounded-md border bg-background p-3 text-sm font-medium transition-colors hover:bg-muted/60"
              >
                Purchase orders
              </Link>
            </div>
          </aside>
        </section>
        )}
      </div>
      <Dialog
        open={expandedDay !== null}
        onOpenChange={(open) => {
          if (!open) setExpandedDay(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {expandedDay ? formatFullDate(expandedDay) : "Calendar items"}
            </DialogTitle>
            <DialogDescription>
              {expandedDayEntries.length} work item
              {expandedDayEntries.length === 1 ? "" : "s"} scheduled for this
              day. Select an item to open its source record.
            </DialogDescription>
          </DialogHeader>
          <div className="-mr-2 max-h-[65vh] space-y-2 overflow-y-auto pr-2">
            {expandedDayEntries.map((entry) => (
              <WorkItem
                key={`${expandedDay}-${entry.kind}-${entry.id}`}
                entry={entry}
                focused={entry.id === initialItemId}
                onEditEvent={(event) => {
                  setExpandedDay(null)
                  setEditingEvent(event)
                }}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {editingEvent && editingEvent.eventDetails.managed && (
        <WorkCalendarEventDialog
          key={`${editingEvent.id}-${editingEvent.eventDetails.version}`}
          variant="edit"
          event={editingEvent}
          open
          onOpenChange={(open) => {
            if (!open) setEditingEvent(null)
          }}
          projects={data.projects}
          attendeeOptions={data.attendeeOptions}
          defaultProjectId={data.defaultProjectId}
          defaultTimeZone={data.defaultTimeZone}
          today={data.today}
          googleDestinations={data.googleDestinations}
        />
      )}
    </div>
  )
}
