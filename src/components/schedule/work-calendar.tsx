"use client"

import * as React from "react"
import Link from "next/link"
import {
  IconCalendarEvent,
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type KindFilter = WorkCalendarEntryKind | "all"

type KindConfig = {
  readonly id: KindFilter
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
    label: "Schedule",
    icon: <IconCalendarEvent className="size-4" />,
  },
  {
    id: "task",
    label: "Tasks",
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
  return date.toISOString().slice(0, 10)
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

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function kindLabel(kind: WorkCalendarEntryKind): string {
  switch (kind) {
    case "schedule":
      return "Schedule"
    case "task":
      return "Task"
    case "rfi":
      return "RFI"
    case "purchase_order":
      return "PO"
  }
}

function kindTone(kind: WorkCalendarEntryKind): string {
  switch (kind) {
    case "schedule":
      return "border-l-[#2f5963]"
    case "task":
      return "border-l-[#3f7d4d]"
    case "rfi":
      return "border-l-[#9d832c]"
    case "purchase_order":
      return "border-l-[#6f471f]"
  }
}

function kindTextTone(kind: WorkCalendarEntryKind): string {
  switch (kind) {
    case "schedule":
      return "text-[#2f5963]"
    case "task":
      return "text-[#3f7d4d]"
    case "rfi":
      return "text-[#715d1c]"
    case "purchase_order":
      return "text-[#6f471f]"
  }
}

function entryMatches(entry: WorkCalendarEntry, query: string): boolean {
  if (!query) return true

  const haystack = normalize(
    [
      entry.projectLabel,
      entry.title,
      entry.status,
      entry.priority,
      entry.assignedTo,
      entry.companyName,
      entry.sourceLabel,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
  )

  return haystack.includes(query)
}

function entryOnDay(entry: WorkCalendarEntry, date: string): boolean {
  return entry.startDate <= date && entry.endDate >= date
}

function WorkItem({
  entry,
  compact = false,
}: {
  readonly entry: WorkCalendarEntry
  readonly compact?: boolean
}): React.ReactElement {
  return (
    <Link
      href={entry.href}
      className={cn(
        "block border-y border-r border-l-2 bg-background px-3 py-2 transition-colors hover:bg-muted/55",
        kindTone(entry.kind),
        compact && "p-2"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("line-clamp-2 font-medium", compact ? "text-xs" : "text-sm")}>
            {entry.title}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {entry.projectLabel} · {entry.sourceLabel}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide",
            kindTextTone(entry.kind)
          )}
        >
          {kindLabel(entry.kind)}
        </span>
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
          {(entry.assignedTo || entry.companyName) && (
            <>
              <span>·</span>
              <span>{entry.assignedTo ?? entry.companyName}</span>
            </>
          )}
        </div>
      )}
    </Link>
  )
}

export function WorkCalendar({
  data,
}: {
  readonly data: WorkCalendarData
}): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const [activeKind, setActiveKind] = React.useState<KindFilter>("all")
  const today = React.useMemo(() => parseDateKey(data.today), [data.today])
  const days = React.useMemo(
    () => Array.from({ length: 14 }, (_, index) => toDateKey(addDays(today, index))),
    [today]
  )
  const normalizedQuery = normalize(query)
  const filteredEntries = data.entries.filter(
    (entry) =>
      (activeKind === "all" || entry.kind === activeKind) &&
      entryMatches(entry, normalizedQuery)
  )
  const overdueEntries = filteredEntries.filter(
    (entry) => entry.endDate < data.today
  )
  const todayEntries = filteredEntries.filter((entry) =>
    entryOnDay(entry, data.today)
  )
  const taskCount = filteredEntries.filter((entry) => entry.kind === "task").length
  const rfiCount = filteredEntries.filter((entry) => entry.kind === "rfi").length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b bg-background">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 md:px-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex size-10 items-center justify-center rounded-md border border-[#3f7d4d] bg-card text-[#3f7d4d]">
                <IconCalendarEvent className="size-5" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                  Work calendar
                </p>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Tasks, due dates, and field follow-ups.
                </h1>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              A cross-project view of work that needs a person, a date, and a
              source record.
            </p>
          </div>

          <div className="grid grid-cols-4 border-y bg-background">
            <div className="border-r px-3 py-2 last:border-r-0">
              <p className="text-xs text-muted-foreground">Today</p>
              <p className="mt-1 text-2xl font-semibold">{todayEntries.length}</p>
            </div>
            <div className="border-r px-3 py-2 last:border-r-0">
              <p className="text-xs text-muted-foreground">Tasks</p>
              <p className="mt-1 text-2xl font-semibold">{taskCount}</p>
            </div>
            <div className="border-r px-3 py-2 last:border-r-0">
              <p className="text-xs text-muted-foreground">RFIs</p>
              <p className="mt-1 text-2xl font-semibold">{rfiCount}</p>
            </div>
            <div className="px-3 py-2">
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
              placeholder="Search by task, project, assignee, RFI, PO..."
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
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

        <section className="border-y py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Next 14 days</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {filteredEntries.length} visible work items across project
                schedules, RFIs, Sage operations, and Compass tasks.
              </p>
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              {formatShortDate(data.today)} onward
            </span>
          </div>

          <div className="mt-4 grid gap-px border bg-border lg:grid-cols-7">
            {days.map((day) => {
              const dayEntries = filteredEntries.filter((entry) =>
                entryOnDay(entry, day)
              )

              return (
                <div key={day} className="min-h-40 bg-background p-2">
                  <div className="flex items-start justify-between gap-2 border-b pb-2">
                    <div>
                      <p className="text-xs font-semibold">{formatWeekday(day)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatShortDate(day)}
                      </p>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {dayEntries.length}
                    </span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {dayEntries.slice(0, 3).map((entry) => (
                      <WorkItem key={`${day}-${entry.kind}-${entry.id}`} entry={entry} compact />
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
          <div>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Work Queue</h2>
              <span className="text-xs text-muted-foreground">
                {filteredEntries.length} items
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              {filteredEntries.length > 0 ? (
                filteredEntries.slice(0, 50).map((entry) => (
                  <WorkItem key={`${entry.kind}-${entry.id}`} entry={entry} />
                ))
              ) : (
                <div className="border border-dashed p-4 text-sm text-muted-foreground">
                  No work items match this view.
                </div>
              )}
            </div>
          </div>

          <aside className="border-l pl-4">
            <h2 className="text-sm font-semibold">Task Sources</h2>
            <div className="mt-3 grid gap-2">
              <Link
                href="/dashboard/projects/select?target=daily-logs"
                className="border-l-2 border-l-[#3f7d4d] bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/60"
              >
                Daily logs
              </Link>
              <Link
                href="/dashboard/projects/select?target=schedule"
                className="border-l-2 border-l-[#2f5963] bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/60"
              >
                Project schedules
              </Link>
              <Link
                href="/dashboard/rfis"
                className="border-l-2 border-l-[#9d832c] bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/60"
              >
                RFIs
              </Link>
              <Link
                href="/dashboard/purchase-orders"
                className="border-l-2 border-l-[#6f471f] bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/60"
              >
                Purchase orders
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </div>
  )
}
