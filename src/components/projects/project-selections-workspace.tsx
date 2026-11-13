"use client"

/*
 * The Selections page's "Finish specs" area: one folded group per room
 * (room, count, "2 need decision" / "all approved" / late risk) with Expand
 * all / Collapse all and Import above. Opening a room shows its selection
 * rows with follow-ups indented, and each row edits through the existing
 * edit sheet. The page's shared filter bar narrows the rooms. Rooms drag
 * into the order clients see (while no filter is on), and each room and row
 * has a "…" menu for its room edits (project-selection-room-controls.tsx).
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
import { reorderProjectSelectionRooms } from "@/app/actions/project-selection-rooms"
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
import { AddSelectionRoomButton, SelectionRoomMenu, SelectionRowMenu } from "@/components/projects/project-selection-room-controls"
import { ReorderHandle, SortableRow, SortableRows } from "@/components/ui/sortable-rows"
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

/** The job's rooms in order, for each row's "Move to room". */
const RoomNamesContext = React.createContext<readonly string[]>([])

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
  const roomNames = React.useContext(RoomNamesContext)

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
        <SelectionRowMenu
          projectId={projectId}
          selection={selection}
          roomNames={roomNames}
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
  roomTypes,
}: {
  readonly projectId: string
  readonly roomTypes: ProjectSelectionOptions["roomTypes"]
}): React.ReactElement {
  return (
    <div className="border bg-background p-8 text-center">
      <IconPalette className="mx-auto size-7 text-muted-foreground" />
      <h2 className="mt-3 text-sm font-semibold">No selections yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Add a room, use "Add selection" at the top of the page, or import a finish schedule workbook.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <AddSelectionRoomButton projectId={projectId} roomTypes={roomTypes} />
        <ProjectFinishScheduleImportSheet projectId={projectId} />
      </div>
    </div>
  )
}

/** `rooms` in the order just dragged (until the page refreshes), else as given. */
function orderedRooms<T extends { readonly roomName: string }>(rooms: readonly T[], order: readonly string[] | null): readonly T[] {
  if (!order) return rooms
  const position = new Map(order.map((name, index) => [name, index]))
  return [...rooms].sort((left, right) => (position.get(left.roomName) ?? order.length) - (position.get(right.roomName) ?? order.length))
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
  const router = useRouter()
  // The order just dragged, shown until the refreshed page brings it back.
  const [order, setOrder] = React.useState<readonly string[] | null>(null)
  const [orderError, setOrderError] = React.useState<string | null>(null)
  // The refreshed rooms carry the saved order.
  React.useEffect(() => setOrder(null), [summary])
  const costCodeMap = React.useMemo(() => buildCostCodeMap(options), [options])
  const lateRisk = React.useMemo(
    () => new Set(leadTimeWarnings.map((warning) => warning.selectionId)),
    [leadTimeWarnings]
  )

  if (summary.rooms.length === 0) {
    return <EmptySelectionsState projectId={projectId} roomTypes={options.roomTypes} />
  }

  const roomNames = summary.rooms.map((room) => room.roomName)
  const rooms = orderedRooms(filteredSummary.rooms, order)
  // Reordering a filtered list would be ambiguous, so rooms drag only while every room shows.
  const canReorder = filteredSummary.totalCount === summary.totalCount && filteredSummary.rooms.length === summary.rooms.length

  function moveRoom(from: number, to: number): void {
    const next = [...rooms.map((room) => room.roomName)]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    setOrder(next)
    setOrderError(null)
    void reorderProjectSelectionRooms(projectId, next).then((result) => {
      if (!result.success) {
        setOrder(null)
        setOrderError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <FoldedGroupsToolbar
        state={folds}
        keys={filteredSummary.rooms.map((room) => room.roomName)}
      >
        <AddSelectionRoomButton projectId={projectId} roomTypes={options.roomTypes} />
        <ProjectFinishScheduleImportSheet projectId={projectId} />
      </FoldedGroupsToolbar>
      {orderError && <p role="alert" className="text-sm text-destructive">{orderError}</p>}

      {filteredSummary.rooms.length === 0 ? (
        <EmptyFilteredState onClear={onClearFilters} />
      ) : (
        <RoomNamesContext.Provider value={roomNames}>
          <div className="space-y-2">
            <SortableRows ids={rooms.map((room) => room.roomName)} onMove={moveRoom} disabled={!canReorder}>
              {rooms.map((room, index) => (
                <SortableRow key={room.roomName} id={room.roomName} index={index}>
                  <FoldedGroup
                    title={room.roomName}
                    subtitle={[room.roomType, room.sourceWorkbookId ? "Workbook room" : null]
                      .filter(Boolean)
                      .join(" · ")}
                    count={room.selections.length}
                    pills={specRoomPills(room.selections, lateRisk)}
                    open={folds.isOpen(room.roomName)}
                    onToggle={() => folds.toggle(room.roomName)}
                    leading={canReorder ? <ReorderHandle label={room.roomName} /> : null}
                    actions={
                      <>
                        <ProjectSelectionCreateForm
                          projectId={projectId}
                          options={options}
                          roomName={room.roomName}
                          roomType={room.roomType ?? ""}
                          triggerLabel="Add"
                          triggerVariant="outline"
                        />
                        <SelectionRoomMenu projectId={projectId} room={room} roomTypes={options.roomTypes} />
                      </>
                    }
                  >
                    <SelectionTree
                      costCodeMap={costCodeMap}
                      options={options}
                      projectId={projectId}
                      selections={room.selections}
                    />
                  </FoldedGroup>
                </SortableRow>
              ))}
            </SortableRows>
          </div>
        </RoomNamesContext.Provider>
      )}
    </div>
  )
}
