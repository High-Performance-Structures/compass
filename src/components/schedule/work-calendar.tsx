"use client"

import * as React from "react"
import Link from "next/link"
import {
  IconCalendarEvent,
  IconCalendarPlus,
  IconClipboardCheck,
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { workCalendarEntryMatches } from "@/lib/work-calendar"
import { WorkCalendarEventDialog } from "./work-calendar-event-dialog"

export type WorkCalendarKindFilter = WorkCalendarEntryKind | "all"
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

function parseDateKey(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
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
  canManageEvents,
}: {
  readonly entry: WorkCalendarEntry
  readonly compact?: boolean
  readonly focused?: boolean
  readonly onEditEvent: (event: CalendarEventEntry) => void
  readonly canManageEvents: boolean
}): React.ReactElement {
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
            {entry.projectLabel} · {entry.sourceLabel}
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
    entry.eventDetails.managed &&
    canManageEvents
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
}: {
  readonly data: WorkCalendarData
  readonly initialKind?: WorkCalendarKindFilter
  readonly initialItemId?: string | null
}): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const [editingEvent, setEditingEvent] =
    React.useState<CalendarEventEntry | null>(null)
  const [activeKind, setActiveKind] =
    React.useState<WorkCalendarKindFilter>(initialKind)
  React.useEffect(() => {
    setActiveKind(initialKind)
  }, [initialKind])
  const today = React.useMemo(() => parseDateKey(data.today), [data.today])
  const days = React.useMemo(
    () => Array.from({ length: 14 }, (_, index) => toDateKey(addDays(today, index))),
    [today]
  )
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
  const taskCount = filteredEntries.filter((entry) => entry.kind === "task").length
  const rfiCount = filteredEntries.filter((entry) => entry.kind === "rfi").length

  React.useEffect(() => {
    if (!initialItemId) return
    document
      .getElementById(`work-calendar-${initialItemId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [initialItemId])

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
          <div className="flex flex-wrap gap-2">
            {data.canCreateEvents && (
              <WorkCalendarEventDialog
                variant="create"
                projects={data.projects}
                attendeeOptions={data.attendeeOptions}
                defaultProjectId={data.defaultProjectId}
                defaultTimeZone={data.defaultTimeZone}
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

        <section className="rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Next 14 days</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {filteredEntries.length} visible work items across project
                schedule items, RFIs, Sage operations, and Compass to-dos.
              </p>
            </div>
            <Badge variant="secondary">{formatShortDate(data.today)} onward</Badge>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-7">
            {days.map((day) => {
              const dayEntries = filteredEntries.filter((entry) =>
                entryOnDay(entry, day)
              )

              return (
                <div key={day} className="min-h-40 rounded-lg border bg-muted/20 p-2">
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
                    {dayEntries.slice(0, 3).map((entry) => (
                      <WorkItem
                        key={`${day}-${entry.kind}-${entry.id}`}
                        entry={entry}
                        compact
                        onEditEvent={setEditingEvent}
                        canManageEvents={data.canManageEvents}
                      />
                    ))}
                    {dayEntries.length > 3 && (
                      <p className="px-1 text-xs text-muted-foreground">
                        +{dayEntries.length - 3} more
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="rounded-lg border bg-card p-4">
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
                    canManageEvents={data.canManageEvents}
                  />
                ))
              ) : (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No work items match this view.
                </div>
              )}
            </div>
          </div>

          <aside className="rounded-lg border bg-card p-4">
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
      </div>
      {editingEvent && data.canManageEvents && (
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
        />
      )}
    </div>
  )
}
