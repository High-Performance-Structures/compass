"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconExternalLink,
  IconFilter,
  IconPalette,
  IconShoppingCartQuestion,
} from "@tabler/icons-react"

import {
  requestSelectionCostCodeSageReview,
  type ProjectSelectionItem,
  type ProjectSelectionOptions,
  type ProjectSelectionsSummary,
} from "@/app/actions/project-selections"
import { ProjectSelectionCreateForm } from "@/components/projects/project-selection-create-form"
import { ProjectSelectionDeleteButton } from "@/components/projects/project-selection-delete-button"
import { ProjectSelectionEditForm } from "@/components/projects/project-selection-edit-form"
import { ProjectSelectionShareActions } from "@/components/projects/project-selection-share-actions"
import { ProjectSelectionStatusSelect } from "@/components/projects/project-selection-status-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type SelectionFilterState = {
  readonly division: string
  readonly costCode: string
  readonly roomName: string
}

type CostCodeDisplay = {
  readonly label: string
  readonly divisionCode: string
  readonly divisionLabel: string
  readonly needsSageReview: boolean
  readonly source: "sage" | "project_budget" | "selection"
}

const ALL = "all"

function formatQuantity(value: number | null): string {
  if (value === null) return "-"
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)
}

function sourceLabel(selection: ProjectSelectionItem): string {
  if (selection.sourceSystem === "google_sheets") return "Sheet"
  if (selection.sourceSystem === "compass") return "Compass"
  if (selection.sourceSystem === "buildertrend_finish_schedule_workbook") {
    return "Imported workbook"
  }
  return selection.sourceSystem
}

function selectionStatusLabel(status: ProjectSelectionItem["status"]): string {
  switch (status) {
    case "proposed":
      return "Proposed"
    case "owner_review":
      return "Owner review"
    case "approved":
      return "Approved"
    case "pricing":
      return "Pricing"
    case "rfq_sent":
      return "RFQ sent"
    case "ordered":
      return "Ordered"
    case "installed":
      return "Installed"
    case "unavailable":
      return "Unavailable"
    case "deferred":
      return "Deferred"
    case "needed":
    default:
      return "Needed"
  }
}

function buildCostCodeMap(
  options: ProjectSelectionOptions
): ReadonlyMap<string, CostCodeDisplay> {
  return new Map(
    options.costCodes.map((option) => [
      option.value,
      {
        label: option.label,
        divisionCode: option.divisionCode,
        divisionLabel: option.divisionLabel,
        needsSageReview: option.needsSageReview,
        source: option.source,
      },
    ])
  )
}

function selectionMatchesFilters(
  selection: ProjectSelectionItem,
  filters: SelectionFilterState,
  costCodeMap: ReadonlyMap<string, CostCodeDisplay>
): boolean {
  if (filters.roomName !== ALL && selection.roomName !== filters.roomName) {
    return false
  }

  if (filters.costCode !== ALL && selection.costCode !== filters.costCode) {
    return false
  }

  if (filters.division !== ALL) {
    if (!selection.costCode) return false
    return costCodeMap.get(selection.costCode)?.divisionCode === filters.division
  }

  return true
}

function summarizeFilteredSelections(
  summary: ProjectSelectionsSummary,
  filters: SelectionFilterState,
  costCodeMap: ReadonlyMap<string, CostCodeDisplay>
): ProjectSelectionsSummary {
  const rooms = summary.rooms
    .map((room) => ({
      ...room,
      selections: room.selections.filter((selection) =>
        selectionMatchesFilters(selection, filters, costCodeMap)
      ),
    }))
    .filter((room) => filters.roomName === ALL || room.roomName === filters.roomName)
    .filter((room) => room.selections.length > 0)
    .map((room) => ({
      ...room,
      selectionCount: room.selections.length,
    }))

  const selections = rooms.flatMap((room) => room.selections)

  return {
    totalCount: selections.length,
    roomCount: rooms.length,
    sourceWorkbookCount: new Set(
      rooms
        .map((room) => room.sourceWorkbookId)
        .filter((value): value is string => Boolean(value))
    ).size,
    needsDecisionCount: selections.filter((selection) =>
      ["needed", "proposed", "owner_review", "unavailable"].includes(
        selection.status
      )
    ).length,
    approvedCount: selections.filter((selection) => selection.status === "approved")
      .length,
    pricingCount: selections.filter((selection) =>
      ["pricing", "rfq_sent"].includes(selection.status)
    ).length,
    orderedCount: selections.filter((selection) =>
      ["ordered", "installed"].includes(selection.status)
    ).length,
    rooms,
  }
}

function filterLabel({
  costCodeMap,
  filters,
  options,
}: {
  readonly costCodeMap: ReadonlyMap<string, CostCodeDisplay>
  readonly filters: SelectionFilterState
  readonly options: ProjectSelectionOptions
}): string | null {
  const parts: string[] = []

  if (filters.roomName !== ALL) parts.push(filters.roomName)
  if (filters.division !== ALL) {
    parts.push(
      options.divisions.find((option) => option.value === filters.division)
        ?.label ?? filters.division
    )
  }
  if (filters.costCode !== ALL) {
    parts.push(costCodeMap.get(filters.costCode)?.label ?? filters.costCode)
  }

  return parts.length > 0 ? parts.join(" / ") : null
}

function selectionCostCodeCounts(
  summary: ProjectSelectionsSummary
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()

  for (const room of summary.rooms) {
    for (const selection of room.selections) {
      if (!selection.costCode) continue
      counts.set(selection.costCode, (counts.get(selection.costCode) ?? 0) + 1)
    }
  }

  return counts
}

function selectionDivisionCounts({
  costCodeCounts,
  costCodeMap,
}: {
  readonly costCodeCounts: ReadonlyMap<string, number>
  readonly costCodeMap: ReadonlyMap<string, CostCodeDisplay>
}): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()

  for (const [costCode, count] of costCodeCounts) {
    const divisionCode = costCodeMap.get(costCode)?.divisionCode
    if (!divisionCode) continue
    counts.set(divisionCode, (counts.get(divisionCode) ?? 0) + count)
  }

  return counts
}

function ProjectSelectionCostCodeReviewButton({
  costCode,
  projectId,
}: {
  readonly costCode: string
  readonly projectId: string
}): React.ReactElement {
  const router = useRouter()
  const [status, setStatus] = React.useState<
    | { readonly kind: "idle" }
    | { readonly kind: "saving" }
    | { readonly kind: "saved" }
    | { readonly kind: "error"; readonly message: string }
  >({ kind: "idle" })

  async function submitRequest(): Promise<void> {
    setStatus({ kind: "saving" })
    const result = await requestSelectionCostCodeSageReview(projectId, costCode)

    if (!result.success) {
      setStatus({ kind: "error", message: result.error })
      return
    }

    setStatus({ kind: "saved" })
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={status.kind === "saving" || status.kind === "saved"}
        onClick={submitRequest}
      >
        {status.kind === "saving"
          ? "Requesting..."
          : status.kind === "saved"
            ? "Requested"
            : "Request Sage add"}
      </Button>
      {status.kind === "error" && (
        <span className="text-xs text-destructive">{status.message}</span>
      )}
    </div>
  )
}

function SelectionRow({
  costCodeMap,
  options,
  projectId,
  selection,
}: {
  readonly costCodeMap: ReadonlyMap<string, CostCodeDisplay>
  readonly options: ProjectSelectionOptions
  readonly projectId: string
  readonly selection: ProjectSelectionItem
}): React.ReactElement {
  const costCode = selection.costCode ? costCodeMap.get(selection.costCode) : null

  return (
    <div className="grid gap-3 border-t px-3 py-3 text-sm lg:grid-cols-[minmax(0,1.2fr)_7rem_minmax(0,.8fr)_minmax(0,.8fr)_9.5rem]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{selection.name}</p>
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            {sourceLabel(selection)}
          </Badge>
        </div>
        {selection.description && (
          <p className="mt-1 text-muted-foreground">{selection.description}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{selection.category}</span>
          {costCode ? (
            <span>{costCode.label}</span>
          ) : (
            selection.costCode && <span>Cost {selection.costCode}</span>
          )}
          {costCode?.needsSageReview && (
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              Needs Sage review
            </Badge>
          )}
          {selection.phaseCode && <span>Phase {selection.phaseCode}</span>}
          {selection.productUrl && (
            <a
              href={selection.productUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Product
              <IconExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium uppercase text-muted-foreground">Qty</p>
        <p className="mt-1">{formatQuantity(selection.quantity)}</p>
      </div>

      <div className="min-w-0">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Manufacturer
        </p>
        <p className="mt-1 truncate">{selection.manufacturer ?? "-"}</p>
        {selection.model && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {selection.model}
          </p>
        )}
      </div>

      <div className="min-w-0">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Finish
        </p>
        <p className="mt-1 truncate">{selection.colorFinish ?? "-"}</p>
        {selection.supplierName && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {selection.supplierName}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <ProjectSelectionEditForm
          options={options}
          projectId={projectId}
          selection={selection}
        />
        <ProjectSelectionDeleteButton
          projectId={projectId}
          selection={selection}
        />
        <ProjectSelectionStatusSelect
          projectId={projectId}
          selectionId={selection.id}
          status={selection.status}
        />
        {selection.rfqOperationId ? (
          <Badge variant="secondary" className="gap-1">
            <IconShoppingCartQuestion className="size-3" />
            RFQ linked
          </Badge>
        ) : (
          <p className="text-xs text-muted-foreground">
            {selectionStatusLabel(selection.status)}
          </p>
        )}
        {selection.costCode && costCode?.needsSageReview && (
          <ProjectSelectionCostCodeReviewButton
            costCode={selection.costCode}
            projectId={projectId}
          />
        )}
      </div>

      {selection.notes && (
        <p className="lg:col-span-5 text-xs text-muted-foreground">
          {selection.notes}
        </p>
      )}
    </div>
  )
}

function EmptyFilteredState({
  onClear,
}: {
  readonly onClear: () => void
}): React.ReactElement {
  return (
    <div className="border bg-background p-8 text-center">
      <IconFilter className="mx-auto size-7 text-muted-foreground" />
      <h2 className="mt-3 text-sm font-semibold">No selections match</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Clear the filters or choose a broader room, division, or cost code.
      </p>
      <Button type="button" variant="outline" className="mt-5" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  )
}

function EmptySelectionsState({
  options,
  projectId,
}: {
  readonly options: ProjectSelectionOptions
  readonly projectId: string
}): React.ReactElement {
  return (
    <div className="border bg-background p-8 text-center">
      <IconPalette className="mx-auto size-7 text-muted-foreground" />
      <h2 className="mt-3 text-sm font-semibold">No selections yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Add the first room-based selection or import a finish schedule workbook.
      </p>
      <div className="mt-5 flex justify-center">
        <ProjectSelectionCreateForm projectId={projectId} options={options} />
      </div>
    </div>
  )
}

export function ProjectSelectionsWorkspace({
  clientName,
  options,
  projectId,
  projectLabel,
  summary,
}: {
  readonly clientName: string | null
  readonly options: ProjectSelectionOptions
  readonly projectId: string
  readonly projectLabel: string
  readonly summary: ProjectSelectionsSummary
}): React.ReactElement {
  const [filters, setFilters] = React.useState<SelectionFilterState>({
    division: ALL,
    costCode: ALL,
    roomName: ALL,
  })
  const costCodeMap = React.useMemo(() => buildCostCodeMap(options), [options])
  const costCodeCounts = React.useMemo(
    () => selectionCostCodeCounts(summary),
    [summary]
  )
  const divisionCounts = React.useMemo(
    () => selectionDivisionCounts({ costCodeCounts, costCodeMap }),
    [costCodeCounts, costCodeMap]
  )
  const codedCount = React.useMemo(
    () =>
      Array.from(costCodeCounts.values()).reduce(
        (total, count) => total + count,
        0
      ),
    [costCodeCounts]
  )
  const divisionOptions = React.useMemo(
    () =>
      options.divisions.filter((option) => divisionCounts.has(option.value)),
    [divisionCounts, options.divisions]
  )
  const costCodeOptions = React.useMemo(
    () =>
      options.costCodes.filter((option) => {
        if (!costCodeCounts.has(option.value)) return false
        return filters.division === ALL || option.divisionCode === filters.division
      }),
    [costCodeCounts, filters.division, options.costCodes]
  )
  const filteredSummary = React.useMemo(
    () => summarizeFilteredSelections(summary, filters, costCodeMap),
    [costCodeMap, filters, summary]
  )
  const activeFilterLabel = filterLabel({ costCodeMap, filters, options })
  const hasFilters =
    filters.division !== ALL || filters.costCode !== ALL || filters.roomName !== ALL

  function clearFilters(): void {
    setFilters({ division: ALL, costCode: ALL, roomName: ALL })
  }

  function changeDivision(value: string): void {
    setFilters((current) => ({
      ...current,
      division: value,
      costCode:
        value === ALL ||
        options.costCodes.some(
          (option) =>
            option.value === current.costCode && option.divisionCode === value
        )
          ? current.costCode
          : ALL,
    }))
  }

  if (summary.rooms.length === 0) {
    return <EmptySelectionsState options={options} projectId={projectId} />
  }

  return (
    <div className="space-y-4">
      <section className="border bg-background">
        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Division
            </span>
            <Select value={filters.division} onValueChange={changeDivision}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All divisions" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={ALL}>All divisions</SelectItem>
                {divisionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} ({divisionCounts.get(option.value) ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Cost code
            </span>
            <Select
              value={filters.costCode}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, costCode: value }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All cost codes" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={ALL}>All cost codes</SelectItem>
                {costCodeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} ({costCodeCounts.get(option.value) ?? 0})
                    {option.needsSageReview ? " - needs Sage review" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Room
            </span>
            <Select
              value={filters.roomName}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, roomName: value }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All rooms" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={ALL}>All rooms</SelectItem>
                {summary.rooms.map((room) => (
                  <SelectItem key={room.roomName} value={room.roomName}>
                    {room.roomName} ({room.selections.length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              className="w-full lg:w-auto"
              disabled={!hasFilters}
              onClick={clearFilters}
            >
              Clear
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Showing {filteredSummary.totalCount} of {summary.totalCount} selections
            {activeFilterLabel ? ` for ${activeFilterLabel}` : ""}
            {" · "}
            {codedCount} cost-coded
          </span>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {filteredSummary.roomCount} room
              {filteredSummary.roomCount === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline">
              {filteredSummary.needsDecisionCount} need decision
            </Badge>
            <Badge variant="outline">
              {filteredSummary.approvedCount} approved
            </Badge>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectSelectionShareActions
          clientName={clientName}
          filterLabel={activeFilterLabel}
          projectId={projectId}
          projectLabel={projectLabel}
          summary={filteredSummary}
        />
        <ProjectSelectionCreateForm projectId={projectId} options={options} />
      </div>

      {filteredSummary.rooms.length === 0 ? (
        <EmptyFilteredState onClear={clearFilters} />
      ) : (
        <div className="space-y-4">
          {filteredSummary.rooms.map((room) => (
            <section key={room.roomName} className="border bg-background">
              <div className="selection-room-header flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                <div>
                  <h2 className="text-base font-extrabold tracking-tight">
                    {room.roomName}
                  </h2>
                  {room.roomType && (
                    <p className="mt-1 text-xs font-medium text-foreground/70">
                      {room.roomType}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {room.selections.length} selection
                    {room.selections.length === 1 ? "" : "s"}
                  </Badge>
                  {room.sourceWorkbookId && (
                    <Badge variant="outline">Workbook room</Badge>
                  )}
                  <ProjectSelectionCreateForm
                    projectId={projectId}
                    options={options}
                    roomName={room.roomName}
                    roomType={room.roomType ?? ""}
                    triggerLabel="Add"
                    triggerVariant="outline"
                  />
                </div>
              </div>
              {room.selections.map((selection) => (
                <SelectionRow
                  key={selection.id}
                  costCodeMap={costCodeMap}
                  options={options}
                  projectId={projectId}
                  selection={selection}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
