"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import type { DutyLogEntryView } from "@/app/actions/internal-duties"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/format"

type DutyLogFilter = "everyone" | "mine"

const rowId = (entry: DutyLogEntryView): string => entry.id

function dutyEntryMatchesSearch(entry: DutyLogEntryView, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [entry.entryDate, entry.userName, entry.dutyCode, entry.dutyLabel, entry.notes, entry.relatedProjectLabel]
    .some((value) => value?.toLowerCase().includes(needle))
}

type DutyLogActions = {
  /** Whether this viewer may edit or delete the entry. */
  readonly canChange: (entry: DutyLogEntryView) => boolean
  readonly pending: boolean
  readonly onEdit: (entry: DutyLogEntryView) => void
  readonly onDelete: (entry: DutyLogEntryView) => void
}

/** The duty log sheet's columns (registry sheet "duty-log.workspace"). */
export function dutyLogColumns(actions: DutyLogActions): ColumnDef<DutyLogEntryView>[] {
  return [
    {
      id: "date",
      accessorFn: (entry) => entry.entryDate,
      header: "Date",
      size: 120,
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.entryDate)}</span>,
    },
    {
      id: "who",
      accessorFn: (entry) => entry.userName.toLocaleLowerCase(),
      header: "Who",
      size: 150,
      cell: ({ row }) => row.original.userName,
    },
    {
      id: "duty",
      accessorFn: (entry) => entry.dutyCode,
      header: "Duty",
      size: 220,
      cell: ({ row: { original } }) => (
        <span>
          <span className="font-mono">{original.dutyCode}</span> {original.dutyLabel}
        </span>
      ),
    },
    {
      id: "hours",
      accessorFn: (entry) => entry.hours ?? undefined,
      header: "Hours",
      size: 90,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">{row.original.hours !== null ? row.original.hours.toFixed(2) : "–"}</span>
      ),
    },
    {
      id: "notes",
      accessorFn: (entry) => entry.notes?.trim() || undefined,
      header: "Notes",
      size: 320,
      cell: ({ row: { original } }) => (
        <div className="min-w-48 break-words">
          {original.notes}
          {original.relatedProjectLabel ? <span className="block text-muted-foreground">For {original.relatedProjectLabel}</span> : null}
        </div>
      ),
    },
    {
      id: "actions",
      enableSorting: false,
      size: 140,
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original } }) =>
        actions.canChange(original) ? (
          <div className="flex justify-end gap-1">
            <Button type="button" size="sm" variant="ghost" disabled={actions.pending} onClick={() => actions.onEdit(original)}>
              Edit
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={actions.pending} onClick={() => actions.onDelete(original)}>
              Delete
            </Button>
          </div>
        ) : null,
    },
  ]
}

/** An internal workspace's duty entries on the shared record table. */
export function DutyLogRecordTable({
  entries,
  currentUserId,
  actions,
}: {
  readonly entries: readonly DutyLogEntryView[]
  readonly currentUserId: string
  readonly actions: DutyLogActions
}): React.ReactElement {
  const [filter, setFilter] = React.useState<DutyLogFilter>("everyone")
  const [query, setQuery] = React.useState("")
  const mine = React.useMemo(() => entries.filter((entry) => entry.userId === currentUserId), [entries, currentUserId])
  const visible = React.useMemo(
    () => (filter === "mine" ? mine : entries).filter((entry) => dutyEntryMatchesSearch(entry, query)),
    [entries, mine, filter, query]
  )
  const columns = React.useMemo(() => dutyLogColumns(actions), [actions])
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: rowId,
    resetKey: `${filter}:${query}`,
    sheetId: "duty-log.workspace",
  })

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusFilterBar
          kind="button"
          label="Filter duty entries by person"
          options={[
            { value: "everyone", label: "Everyone", count: entries.length, pinned: true },
            { value: "mine", label: "Mine", count: mine.length, pinned: true },
          ]}
          selected={filter}
          onSelect={setFilter}
        />
        <RecordSearchInput
          value={query}
          onChange={setQuery}
          label="Search the duty log"
          placeholder="Search duty, person, notes or job…"
          className="sm:max-w-sm"
        />
      </div>
      <RecordTable
        table={table}
        itemLabel="duty entries"
        emptyMessage={query ? "No duty entries match this search." : "No duty entries match this filter."}
        rowIdPrefix="duty-entry-row"
        onRowOpen={(entry) => {
          if (actions.canChange(entry)) actions.onEdit(entry)
        }}
      />
    </div>
  )
}
