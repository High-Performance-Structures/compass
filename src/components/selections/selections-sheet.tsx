"use client"

/*
 * A job's Selections sheet (registry sheet "selections.job"): status filter
 * buttons, search, and a sortable sheet whose default order keeps each room
 * together with follow-up selections indented under the selection that
 * opens them, and a "Late risk" filter for selections whose lead time puts
 * them at risk of arriving late. Clicking a row opens it in the standard
 * record drawer (`?item=<id>` in the URL, so links open it too); Previous and
 * Next in the drawer step through the rows as filtered and sorted, and
 * "Add selection" above the sheet opens the create drawer.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"
import { IconAlertTriangle, IconChevronLeft, IconChevronRight } from "@tabler/icons-react"

import { useListSheetFilterLabel } from "@/components/list-sheets/use-list-sheet"
import { RecordDrawer, useRecordDrawerItem } from "@/components/record-drawer"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { RecordStatusBadge } from "@/components/record-status-badge"
import { ProjectSelectionCreateForm } from "@/components/projects/project-selection-create-form"
import { OverUnder } from "@/components/selections/selection-choice-card"
import { ChoiceTemplatesDialog } from "@/components/selections/choice-templates-dialog"
import { SaveToCompassBookmarklet } from "@/components/selections/save-to-compass-bookmarklet"
import { SelectionDetailPanel } from "@/components/selections/selection-detail-panel"
import { SelectionRoundCards } from "@/components/selections/selection-round-cards"
import { SourceTag } from "@/components/shared/source-tag"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { Button } from "@/components/ui/button"
import { recordStep } from "@/lib/shared/record-step"
import type { ProjectSelectionOptions } from "@/lib/domain/selections/types"
import { leadTimeLabel, type SelectionLeadTimeWarning } from "@/lib/domain/selections/lead-time-rules"
import type { RoundCard } from "@/lib/domain/selections/rounds-server"
import { selectionStatusDisplay, type SelectionStatusLabels } from "@/lib/domain/selections/status-labels"
import type { SupplierOption } from "@/lib/domain/selections/selection-sheet-read"
import type { RecordStatusColor } from "@/lib/domain/record-statuses/statuses"
import { formatDate } from "@/lib/format"
import {
  selectionListFilters,
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

/** The short lead-time flag under a selection's name in the sheet. */
function LeadTimeFlag({ warning }: { readonly warning: SelectionLeadTimeWarning | undefined }): React.ReactElement | null {
  if (!warning) return null
  return (
    <p className={cn("text-xs font-medium", warning.level === "late" ? "text-destructive" : "text-warning")}>
      {leadTimeLabel(warning.leadTimeDays)} ·{" "}
      {warning.level === "late" ? `won't arrive by ${formatDate(warning.neededByDate, "short")}` : `order by ${formatDate(warning.orderByDate, "short")}`}
    </p>
  )
}

/** The Selections sheet's columns (registry sheet "selections.job"). */
export function selectionColumns(
  roundNames: ReadonlyMap<string, string> = new Map(),
  statusLabels?: SelectionStatusLabels,
  leadTimes: ReadonlyMap<string, SelectionLeadTimeWarning> = new Map(),
): ColumnDef<SelectionSheetRow>[] {
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
          <LeadTimeFlag warning={leadTimes.get(original.id)} />
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
        <RecordStatusBadge label={selectionStatusDisplay(original.status, statusLabels, original.signed)} color={GROUP_COLOR[selectionStatusGroup(original.status)]} />
      ),
    },
  ]
}

export function SelectionsSheet({
  projectId,
  rows,
  suppliers,
  rounds,
  statusLabels,
  leadTimeWarnings,
  initialFilter,
  initialOpenId = null,
  createOptions,
}: {
  readonly projectId: string
  readonly rows: readonly SelectionSheetRow[]
  /** Rooms, cost codes and statuses for the "Add selection" drawer. */
  readonly createOptions: ProjectSelectionOptions
  readonly suppliers: readonly SupplierOption[]
  readonly rounds: readonly RoundCard[]
  /** The company's status names (Settings › Selections › Status names). */
  readonly statusLabels: SelectionStatusLabels
  /** Selections at risk of arriving late because of a lead time, from the server. */
  readonly leadTimeWarnings: readonly SelectionLeadTimeWarning[]
  readonly initialFilter: SelectionListFilter
  /** A selection to open on arrival (`?item=`, for example from "Save to Compass"). */
  readonly initialOpenId?: string | null
}): React.ReactElement {
  const router = useRouter()
  const [filter, setFilter] = React.useState<SelectionListFilter>(initialFilter)
  const [query, setQuery] = React.useState("")
  const [openId, openItem, closeItem] = useRecordDrawerItem(initialOpenId && rows.some((row) => row.id === initialOpenId) ? initialOpenId : null)
  // A round key, "" for selections in no round, or null for every round.
  const [round, setRound] = React.useState<string | null>(null)
  const inRound = React.useMemo(
    () => (round === null ? rows : rows.filter((row) => (row.roundKey ?? "") === round)),
    [rows, round],
  )
  const leadTimes = React.useMemo(() => new Map(leadTimeWarnings.map((warning) => [warning.selectionId, warning])), [leadTimeWarnings])
  const [lateRiskOnly, setLateRiskOnly] = React.useState(false)
  const lateRiskCount = inRound.filter((row) => leadTimes.has(row.id)).length
  const visible = React.useMemo(
    () =>
      inRound.filter(
        (row) => selectionMatchesFilter(row, filter) && selectionMatchesSearch(row, query) && (!lateRiskOnly || leadTimes.has(row.id)),
      ),
    [inRound, filter, query, lateRiskOnly, leadTimes],
  )
  const roundNames = React.useMemo(() => new Map(rounds.map((item) => [item.key, item.name])), [rounds])
  const columns = React.useMemo(() => selectionColumns(roundNames, statusLabels, leadTimes), [roundNames, statusLabels, leadTimes])
  const filterLabel = useListSheetFilterLabel("selections.job")
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: rowId,
    resetKey: `${filter}:${query}:${round ?? "*"}:${lateRiskOnly ? "late" : ""}`,
    sheetId: "selections.job",
    // Keeps the sheet on the open selection's page, including after Previous / Next.
    initialItemId: openId,
  })
  const open = rows.find((row) => row.id === openId) ?? null
  const refresh = React.useCallback(() => router.refresh(), [router])

  // The older Save to Compass link used `?selection=`; swap it for the standard `?item=` once.
  React.useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has("selection")) return
    url.searchParams.delete("selection")
    if (openId !== null) url.searchParams.set("item", openId)
    window.history.replaceState(null, "", url)
    // Only on arrival; later opens keep `?item=` through the drawer hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Previous / Next follow the sheet's current filter, search and sort, across pages.
  const step = recordStep(
    table.getPrePaginationRowModel().rows.map((row) => row.id),
    openId,
  )

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
        <div className="flex flex-wrap items-center gap-1">
          <ProjectSelectionCreateForm projectId={projectId} options={createOptions} />
          <SaveToCompassBookmarklet variant="compact" />
          <StatusFilterBar
            kind="button"
            label="Filter selections by status"
            options={selectionListFilters(statusLabels).map((option) => ({
              ...option,
              label: filterLabel(option.value, option.label),
              count: inRound.filter((row) => selectionMatchesFilter(row, option.value)).length,
              pinned: option.value === "open" || option.value === "all",
            }))}
            selected={filter}
            onSelect={setFilter}
          />
          {(lateRiskCount > 0 || lateRiskOnly) && (
            <Button
              type="button"
              size="sm"
              variant={lateRiskOnly ? "secondary" : "ghost"}
              aria-pressed={lateRiskOnly}
              title="Selections whose lead time means they must be ordered soon, or may not arrive in time"
              onClick={() => setLateRiskOnly((value) => !value)}
            >
              <IconAlertTriangle className="size-4 text-warning" />
              Late risk
              <span className="tabular-nums text-muted-foreground">{lateRiskCount}</span>
            </Button>
          )}
        </div>
        <RecordSearchInput
          value={query}
          onChange={setQuery}
          label="Search selections"
          placeholder="Search selection, room, cost code or pick…"
          className="sm:max-w-sm"
        />
      </div>
      <RecordTable
        table={table}
        itemLabel="selections"
        emptyMessage={query ? "No selections match this search." : "No selections match this filter."}
        rowIdPrefix="selection-row"
        focusedRowId={openId}
        scrollToFocusedRow={false}
        onRowOpen={(row) => openItem(row.id)}
      />
      {/* An opened selection shows in the record drawer over the sheet, so the list stays in place. */}
      <RecordDrawer
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) closeItem()
        }}
        title={
          open ? (
            <>
              {open.name}
              {open.sourceSystem === "buildertrend" && <SourceTag source="buildertrend" className="ml-1.5" />}
            </>
          ) : (
            "Selection"
          )
        }
        description={open ? [open.roomName, open.costCode, open.parentName ? `Follow-up of ${open.parentName}` : null].filter(Boolean).join(" · ") : undefined}
        headerActions={
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Previous selection"
              title="Previous selection"
              disabled={step.kind !== "listed" || step.previousId === null}
              onClick={() => {
                if (step.kind === "listed" && step.previousId !== null) openItem(step.previousId)
              }}
            >
              <IconChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Next selection"
              title="Next selection"
              disabled={step.kind !== "listed" || step.nextId === null}
              onClick={() => {
                if (step.kind === "listed" && step.nextId !== null) openItem(step.nextId)
              }}
            >
              <IconChevronRight className="size-4" />
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {step.kind === "listed" ? `${step.position} of ${step.total}` : "Not in the current filter"}
            </span>
          </>
        }
      >
        {open ? (
          <SelectionDetailPanel
            key={open.id}
            projectId={projectId}
            row={open}
            rows={rows}
            rounds={rounds}
            suppliers={suppliers}
            statusLabels={statusLabels}
            leadTimeWarning={leadTimes.get(open.id) ?? null}
            onChanged={refresh}
          />
        ) : null}
      </RecordDrawer>
    </div>
  )
}
