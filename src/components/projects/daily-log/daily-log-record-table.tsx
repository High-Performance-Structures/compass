"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import type { ProjectDailyLogItem } from "@/app/actions/project-field"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { RecordStatusBadge } from "@/components/record-status-badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  dailyLogFlags,
  dailyLogMatchesSearch,
  dailyLogWeatherLabel,
  dailyLogWorkSummary,
} from "@/lib/daily-logs/record-list"
import { formatDate } from "@/lib/format"

const rowId = (log: ProjectDailyLogItem): string => log.id

function Muted({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return <span className="text-muted-foreground">{children}</span>
}

export function dailyLogColumns(
  selectedIds: ReadonlySet<string>,
  onToggle: (logId: string) => void,
  onOpen: (log: ProjectDailyLogItem) => void
): ColumnDef<ProjectDailyLogItem>[] {
  return [
    {
      id: "select",
      enableSorting: false,
      size: 40,
      header: () => <span className="sr-only">Selected</span>,
      cell: ({ row: { original } }) => (
        <Checkbox
          aria-label={`Select the ${original.logDate} daily log`}
          checked={selectedIds.has(original.id)}
          onCheckedChange={() => onToggle(original.id)}
        />
      ),
    },
    {
      id: "date",
      accessorFn: (log) => log.logDate,
      header: "Date",
      size: 130,
      cell: ({ row: { original } }) => (
        <button
          type="button"
          onClick={() => onOpen(original)}
          className="whitespace-nowrap font-medium text-primary tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {formatDate(original.logDate, "medium", original.logDate)}
        </button>
      ),
    },
    {
      id: "author",
      accessorFn: (log) => log.authorName?.trim() || undefined,
      header: "Author",
      size: 140,
      cell: ({ row }) => row.original.authorName || <Muted>—</Muted>,
    },
    {
      id: "work",
      accessorFn: (log) => dailyLogWorkSummary(log) || undefined,
      header: "Work completed",
      size: 320,
      cell: ({ row: { original } }) => {
        const summary = dailyLogWorkSummary(original)
        return summary ? <p className="line-clamp-2 min-w-48 break-words">{summary}</p> : <Muted>—</Muted>
      },
    },
    {
      id: "hours",
      accessorFn: (log) => log.hoursWorked ?? undefined,
      header: "Crew hours",
      size: 100,
      cell: ({ row: { original } }) => (
        <span className="block text-right tabular-nums">
          {original.hoursWorked === null ? <Muted>—</Muted> : original.hoursWorked.toFixed(1)}
        </span>
      ),
    },
    {
      id: "weather",
      accessorFn: (log) => dailyLogWeatherLabel(log) ?? undefined,
      header: "Weather",
      size: 160,
      cell: ({ row }) => dailyLogWeatherLabel(row.original) ?? <Muted>—</Muted>,
    },
    {
      id: "photos",
      accessorFn: (log) => log.photos.length,
      header: "Photos",
      size: 80,
      cell: ({ row }) => <span className="block text-right tabular-nums">{row.original.photos.length}</span>,
    },
    {
      id: "issues",
      accessorFn: (log) => dailyLogFlags(log).length,
      header: "Issues",
      size: 120,
      cell: ({ row }) => {
        const flags = dailyLogFlags(row.original)
        return flags.length === 0 ? (
          <Muted>—</Muted>
        ) : (
          <span className="flex flex-wrap gap-1">
            {flags.map((flag) => (
              <RecordStatusBadge key={flag} label={flag === "safety" ? "Safety" : "Issue"} color={flag === "safety" ? "red" : "orange"} />
            ))}
          </span>
        )
      },
    },
    {
      id: "status",
      accessorFn: (log) => (log.reviewStatus === "approved" ? 1 : 0),
      header: "Status",
      size: 130,
      cell: ({ row }) =>
        row.original.reviewStatus === "approved" ? (
          <RecordStatusBadge label="Approved" color="green" />
        ) : (
          <RecordStatusBadge label="Needs review" color="orange" />
        ),
    },
    {
      id: "owner",
      accessorFn: (log) => (log.isClientVisible ? 1 : 0),
      header: "Owner",
      size: 100,
      cell: ({ row }) => (row.original.isClientVisible ? <RecordStatusBadge label="Visible" color="blue" /> : <Muted>Internal</Muted>),
    },
  ]
}

/** A job's daily logs on the shared record table: sort, search, paging and row open. */
export function DailyLogRecordTable({
  logs,
  filterKey,
  selectedIds,
  onToggle,
  openLogId,
  onOpen,
}: {
  readonly logs: readonly ProjectDailyLogItem[]
  /** Changes when the status filter changes, so paging resets. */
  readonly filterKey: string
  readonly selectedIds: readonly string[]
  readonly onToggle: (logId: string) => void
  /** The log open below the sheet. */
  readonly openLogId: string | null
  readonly onOpen: (log: ProjectDailyLogItem) => void
}): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const visibleLogs = React.useMemo(() => logs.filter((log) => dailyLogMatchesSearch(log, query)), [logs, query])
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds])
  const columns = React.useMemo(() => dailyLogColumns(selected, onToggle, onOpen), [selected, onToggle, onOpen])
  const table = useRecordTable({
    data: visibleLogs,
    columns,
    getRowId: rowId,
    resetKey: `${filterKey}:${query}`,
    initialItemId: openLogId,
    sheetId: "daily-logs.job",
  })

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RecordSearchInput
        value={query}
        onChange={setQuery}
        label="Search daily logs"
        placeholder="Search work, notes, author or cost code…"
        className="sm:max-w-md"
      />
      <RecordTable
        table={table}
        itemLabel="daily logs"
        emptyMessage={query ? "No daily logs match this search." : "No daily logs match this filter yet."}
        rowIdPrefix="daily-log-row"
        // The open log shows below the sheet; highlight its row without
        // pulling the page back up to it.
        focusedRowId={openLogId}
        scrollToFocusedRow={false}
        onRowOpen={onOpen}
      />
    </div>
  )
}
