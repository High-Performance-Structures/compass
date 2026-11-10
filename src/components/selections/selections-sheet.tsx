"use client"

/*
 * A job's Selections sheet (registry sheet "selections.job"): status filter
 * buttons, search, and a sortable sheet whose default order keeps each room
 * together with follow-up selections indented under the selection that
 * opens them. Clicking a row opens its detail panel beside the sheet.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"

import { useListSheetFilterLabel } from "@/components/list-sheets/use-list-sheet"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { RecordStatusBadge } from "@/components/record-status-badge"
import { OverUnder } from "@/components/selections/selection-choice-card"
import { ChoiceTemplatesDialog } from "@/components/selections/choice-templates-dialog"
import { SelectionDetailPanel } from "@/components/selections/selection-detail-panel"
import { SelectionRoundCards } from "@/components/selections/selection-round-cards"
import { SourceTag } from "@/components/shared/source-tag"
import { StatusFilterBar } from "@/components/status-filter-bar"
import type { RoundCard } from "@/lib/domain/selections/rounds-server"
import type { SupplierOption } from "@/lib/domain/selections/selection-sheet-read"
import type { RecordStatusColor } from "@/lib/domain/record-statuses/statuses"
import { formatDate } from "@/lib/format"
import {
  SELECTION_LIST_FILTERS,
  SELECTION_STATUS_LABELS,
  selectionMatchesFilter,
  selectionMatchesSearch,
  selectionStatusGroup,
  selectionStatusSortValue,
  type SelectionListFilter,
  type SelectionSheetRow,
} from "@/lib/selections/sheet"
import { cn } from "@/lib/utils"

const GROUP_COLOR: Readonly<Record<ReturnType<typeof selectionStatusGroup>, RecordStatusColor>> = {
  needed: "orange",
  with_owner: "blue",
  approved: "green",
  ordered: "blue",
  installed: "gray",
  deferred: "gray",
}

const rowId = (row: SelectionSheetRow): string => row.id

/** The Selections sheet's columns (registry sheet "selections.job"). */
export function selectionColumns(roundNames: ReadonlyMap<string, string> = new Map()): ColumnDef<SelectionSheetRow>[] {
  const roundName = (row: SelectionSheetRow): string | undefined => (row.roundKey ? roundNames.get(row.roundKey) : undefined)
  return [
    {
      id: "selection",
      accessorFn: (row) => row.orderKey,
      header: "Selection",
      size: 260,
      cell: ({ row: { original } }) => (
        <div className={cn("min-w-44", original.parentId && "pl-5")}>
          <span className={cn("break-words", !original.parentId && "font-semibold")}>
            {original.parentId && <span aria-hidden className="text-muted-foreground">↳ </span>}
            {original.name}
          </span>
          {original.sourceSystem === "buildertrend" && <SourceTag source="buildertrend" className="ml-1" />}
          {original.followUpCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Opens {original.followUpCount} follow-up{original.followUpCount === 1 ? "" : "s"}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "room",
      accessorFn: (row) => row.roomName.toLocaleLowerCase(),
      header: "Room",
      size: 140,
      cell: ({ row: { original } }) => <span className="break-words">{original.roomName}</span>,
    },
    {
      id: "round",
      accessorFn: (row) => roundName(row)?.toLocaleLowerCase(),
      header: "Selection Phase",
      size: 120,
      cell: ({ row: { original } }) => <span className="break-words">{roundName(original) ?? <span className="text-muted-foreground">—</span>}</span>,
    },
    {
      id: "costCode",
      accessorFn: (row) => row.costCode ?? undefined,
      header: "Cost code",
      size: 160,
      cell: ({ row: { original } }) => <span className="break-words">{original.costCode ?? <span className="text-muted-foreground">—</span>}</span>,
    },
    {
      id: "choices",
      accessorFn: (row) => row.choiceCount,
      header: "Choices",
      size: 90,
      cell: ({ row: { original } }) => <span className="block text-right tabular-nums">{original.choiceCount}</span>,
    },
    {
      id: "pick",
      accessorFn: (row) => row.pickTitle?.toLocaleLowerCase() ?? undefined,
      header: "Owner's pick",
      size: 180,
      cell: ({ row: { original } }) =>
        original.pickTitle ? <span className="break-words">{original.pickTitle}</span> : <span className="text-muted-foreground">Not chosen</span>,
    },
    {
      id: "allowance",
      accessorFn: (row) => row.deltaCents ?? undefined,
      header: "vs allowance",
      size: 120,
      cell: ({ row: { original } }) => (
        <span className="block whitespace-nowrap text-right tabular-nums">
          {original.deltaCents === null ? <span className="text-muted-foreground">—</span> : <OverUnder deltaCents={original.deltaCents} />}
        </span>
      ),
    },
    {
      id: "due",
      accessorFn: (row) => row.dueDate ?? undefined,
      header: "Due",
      size: 110,
      cell: ({ row: { original } }) => <span className="whitespace-nowrap tabular-nums">{formatDate(original.dueDate, "medium", "—")}</span>,
    },
    {
      id: "status",
      accessorFn: (row) => selectionStatusSortValue(row.status),
      header: "Status",
      size: 130,
      cell: ({ row: { original } }) => (
        <RecordStatusBadge label={SELECTION_STATUS_LABELS[original.status]} color={GROUP_COLOR[selectionStatusGroup(original.status)]} />
      ),
    },
  ]
}

export function SelectionsSheet({
  projectId,
  rows,
  suppliers,
  rounds,
  initialFilter,
  initialOpenId = null,
}: {
  readonly projectId: string
  readonly rows: readonly SelectionSheetRow[]
  readonly suppliers: readonly SupplierOption[]
  readonly rounds: readonly RoundCard[]
  readonly initialFilter: SelectionListFilter
  /** A selection to open on arrival (for example from "Save to Compass"). */
  readonly initialOpenId?: string | null
}): React.ReactElement {
  const router = useRouter()
  const [filter, setFilter] = React.useState<SelectionListFilter>(initialFilter)
  const [query, setQuery] = React.useState("")
  const [openId, setOpenId] = React.useState<string | null>(() => (initialOpenId && rows.some((row) => row.id === initialOpenId) ? initialOpenId : null))
  // A round key, "" for selections in no round, or null for every round.
  const [round, setRound] = React.useState<string | null>(null)
  const inRound = React.useMemo(
    () => (round === null ? rows : rows.filter((row) => (row.roundKey ?? "") === round)),
    [rows, round],
  )
  const visible = React.useMemo(
    () => inRound.filter((row) => selectionMatchesFilter(row, filter) && selectionMatchesSearch(row, query)),
    [inRound, filter, query],
  )
  const roundNames = React.useMemo(() => new Map(rounds.map((item) => [item.key, item.name])), [rounds])
  const columns = React.useMemo(() => selectionColumns(roundNames), [roundNames])
  const filterLabel = useListSheetFilterLabel("selections.job")
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: rowId,
    resetKey: `${filter}:${query}:${round ?? "*"}`,
    sheetId: "selections.job",
  })
  const open = rows.find((row) => row.id === openId) ?? null
  const refresh = React.useCallback(() => router.refresh(), [router])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ChoiceTemplatesDialog projectId={projectId} />
      </div>
      <SelectionRoundCards
        projectId={projectId}
        rounds={rounds}
        selected={round}
        onSelect={setRound}
        unassigned={rows.filter((row) => !row.roundKey || !roundNames.has(row.roundKey)).length}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusFilterBar
          kind="button"
          label="Filter selections by status"
          options={SELECTION_LIST_FILTERS.map((option) => ({
            ...option,
            label: filterLabel(option.value, option.label),
            count: inRound.filter((row) => selectionMatchesFilter(row, option.value)).length,
            pinned: option.value === "open" || option.value === "all",
          }))}
          selected={filter}
          onSelect={setFilter}
        />
        <RecordSearchInput
          value={query}
          onChange={setQuery}
          label="Search selections"
          placeholder="Search selection, room, cost code or pick…"
          className="sm:max-w-sm"
        />
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_560px]">
          <RecordTable
            table={table}
            itemLabel="selections"
            emptyMessage={query ? "No selections match this search." : "No selections match this filter."}
            rowIdPrefix="selection-row"
            focusedRowId={openId}
            onRowOpen={(row) => setOpenId(row.id)}
          />
        </div>
        {open && (
          <div className="min-w-0 flex-[1_1_400px]">
            <SelectionDetailPanel key={open.id} projectId={projectId} row={open} rows={rows} rounds={rounds} suppliers={suppliers} onChanged={refresh} />
          </div>
        )}
      </div>
    </div>
  )
}
