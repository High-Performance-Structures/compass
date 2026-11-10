"use client"

/*
 * The Selections page's "Finish specs" area: one folded group per room
 * (room, count, "2 need decision" / "all approved" / late risk) with Expand
 * all / Collapse all and Import above. Opening a room shows its selection
 * rows with follow-ups indented, and each row edits through the existing
 * edit sheet. The page's shared filter bar narrows the rooms.
 */
import { selectionStatusLabel } from "@/lib/domain/selections/status-labels"
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
} from "@/app/actions/project-selections"
import type {
  ProjectSelectionItem,
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import { ProjectSelectionCreateForm } from "@/components/projects/project-selection-create-form"
import { ProjectFinishScheduleImportSheet } from "@/components/projects/project-finish-schedule-import-sheet"
import { ProjectSelectionDeleteButton } from "@/components/projects/project-selection-delete-button"
import { ProjectSelectionEditForm } from "@/components/projects/project-selection-edit-form"
import { ProjectSelectionStatusSelect } from "@/components/projects/project-selection-status-select"
import { DeveloperOnly } from "@/components/developer-mode-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FoldedGroup, FoldedGroupsToolbar, useFoldedGroups } from "@/components/folded-groups"
import type { SelectionLeadTimeWarning } from "@/lib/domain/selections/lead-time-rules"
import { specRoomPills } from "@/lib/selections/work-filter"

type CostCodeDisplay = {
  readonly label: string
  readonly divisionCode: string
  readonly divisionLabel: string
  readonly needsSageReview: boolean
  readonly source: ProjectSelectionOptions["costCodes"][number]["source"]
}

function formatQuantity(value: number | null): string {
  if (value === null) return "-"
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)
}

function sourceLabel(selection: ProjectSelectionItem): string {
  if (selection.sourceSystem === "google_sheets") return "Sheet"
  if (selection.sourceSystem === "compass") return "Compass"
  return selection.sourceSystem
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
          <DeveloperOnly>
            <Badge variant="outline" className="h-5 px-1.5 text-xs">
              {sourceLabel(selection)}
            </Badge>
          </DeveloperOnly>
          {selection.parentChoiceValue && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              After {selection.parentChoiceValue}
            </Badge>
          )}
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
            <DeveloperOnly>
              <Badge variant="outline" className="border-warning text-warning">
                Needs Sage review
              </Badge>
            </DeveloperOnly>
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
          labels={options.statusLabels}
        />
        {selection.rfqOperationId ? (
          <Badge variant="secondary" className="gap-1">
            <IconShoppingCartQuestion className="size-3" />
            RFQ linked
          </Badge>
        ) : (
          <p className="text-xs text-muted-foreground">
            {selectionStatusLabel(selection.status, options.statusLabels)}
          </p>
        )}
        {selection.costCode && costCode?.needsSageReview && (
          <DeveloperOnly>
            <ProjectSelectionCostCodeReviewButton
              costCode={selection.costCode}
              projectId={projectId}
            />
          </DeveloperOnly>
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

function SelectionTree({
  costCodeMap,
  options,
  projectId,
  selections,
}: {
  readonly costCodeMap: ReadonlyMap<string, CostCodeDisplay>
  readonly options: ProjectSelectionOptions
  readonly projectId: string
  readonly selections: readonly ProjectSelectionItem[]
}): React.ReactElement {
  const selectionIds = new Set(selections.map((selection) => selection.id))
  const childrenByParent = new Map<string, ProjectSelectionItem[]>()

  for (const selection of selections) {
    if (!selection.parentSelectionId || !selectionIds.has(selection.parentSelectionId)) {
      continue
    }
    const children = childrenByParent.get(selection.parentSelectionId) ?? []
    children.push(selection)
    childrenByParent.set(selection.parentSelectionId, children)
  }

  const roots = selections.filter(
    (selection) =>
      !selection.parentSelectionId || !selectionIds.has(selection.parentSelectionId)
  )

  function renderSelection(
    selection: ProjectSelectionItem,
    level: number
  ): React.ReactNode {
    const children = childrenByParent.get(selection.id) ?? []
    const visibleChildren = children.filter(
      (child) =>
        child.parentChoiceValue === null ||
        child.parentChoiceValue === selection.colorFinish
    )

    return (
      <React.Fragment key={selection.id}>
        <div
          className={level > 0 ? "border-l-2 border-primary/30" : undefined}
          style={level > 0 ? { marginLeft: `${Math.min(level, 3) * 16}px` } : undefined}
        >
          <SelectionRow
            costCodeMap={costCodeMap}
            options={options}
            projectId={projectId}
            selection={selection}
          />
        </div>
        {visibleChildren.map((child) => renderSelection(child, level + 1))}
        {children.length > 0 && visibleChildren.length === 0 && (
          <div
            className="border-l-2 border-dashed border-muted-foreground/30 px-3 py-2 text-xs text-muted-foreground"
            style={{ marginLeft: `${Math.min(level + 1, 3) * 16}px` }}
          >
            Choose an option above to reveal the related follow-up selections.
          </div>
        )}
      </React.Fragment>
    )
  }

  return <>{roots.map((selection) => renderSelection(selection, 0))}</>
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
  projectId,
}: {
  readonly projectId: string
}): React.ReactElement {
  return (
    <div className="border bg-background p-8 text-center">
      <IconPalette className="mx-auto size-7 text-muted-foreground" />
      <h2 className="mt-3 text-sm font-semibold">No selections yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Use "Add selection" at the top of the page, or import a finish schedule workbook.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <ProjectFinishScheduleImportSheet projectId={projectId} />
      </div>
    </div>
  )
}

export function ProjectSelectionsWorkspace({
  options,
  projectId,
  summary,
  filteredSummary,
  onClearFilters,
  leadTimeWarnings = [],
}: {
  readonly options: ProjectSelectionOptions
  readonly projectId: string
  /** Every room, for the empty state. */
  readonly summary: ProjectSelectionsSummary
  /** The rooms the page's shared filter shows. */
  readonly filteredSummary: ProjectSelectionsSummary
  readonly onClearFilters: () => void
  readonly leadTimeWarnings?: readonly SelectionLeadTimeWarning[]
}): React.ReactElement {
  const folds = useFoldedGroups()
  const costCodeMap = React.useMemo(() => buildCostCodeMap(options), [options])
  const lateRisk = React.useMemo(
    () => new Set(leadTimeWarnings.map((warning) => warning.selectionId)),
    [leadTimeWarnings]
  )

  if (summary.rooms.length === 0) {
    return <EmptySelectionsState projectId={projectId} />
  }

  return (
    <div className="space-y-3">
      <FoldedGroupsToolbar
        state={folds}
        keys={filteredSummary.rooms.map((room) => room.roomName)}
      >
        <ProjectFinishScheduleImportSheet projectId={projectId} />
      </FoldedGroupsToolbar>

      {filteredSummary.rooms.length === 0 ? (
        <EmptyFilteredState onClear={onClearFilters} />
      ) : (
        <div className="space-y-2">
          {filteredSummary.rooms.map((room) => (
            <FoldedGroup
              key={room.roomName}
              title={room.roomName}
              subtitle={[room.roomType, room.sourceWorkbookId ? "Workbook room" : null]
                .filter(Boolean)
                .join(" · ")}
              count={room.selections.length}
              pills={specRoomPills(room.selections, lateRisk)}
              open={folds.isOpen(room.roomName)}
              onToggle={() => folds.toggle(room.roomName)}
              actions={
                <ProjectSelectionCreateForm
                  projectId={projectId}
                  options={options}
                  roomName={room.roomName}
                  roomType={room.roomType ?? ""}
                  triggerLabel="Add"
                  triggerVariant="outline"
                />
              }
            >
              <SelectionTree
                costCodeMap={costCodeMap}
                options={options}
                projectId={projectId}
                selections={room.selections}
              />
            </FoldedGroup>
          ))}
        </div>
      )}
    </div>
  )
}
