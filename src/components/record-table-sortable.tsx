"use client"

import * as React from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconArrowDown,
  IconArrowUp,
  IconDotsVertical,
  IconGripVertical,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TableCell, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * What a record table in priority order mode needs from its controller
 * (`usePriorityRecordTable`). Kept free of table imports so the table and the
 * hook can both use it.
 */
export type RecordPriorityController<T> = {
  /** What the order is called, such as "Ordering priority". */
  readonly label: string
  /** The viewer may change the order (permission, not view state). */
  readonly canReorder: boolean
  /** Shown in priority order (no column sort). */
  readonly inPriorityView: boolean
  /** A search is narrowing the list. */
  readonly searching: boolean
  /** The header of the column the list is sorted by, while sorted. */
  readonly sortedBy: string | null
  /** Handles, arrows and row moves work right now. */
  readonly dragEnabled: boolean
  readonly pending: boolean
  /** Polite status for screen readers after a move or a failed save. */
  readonly announcement: string
  readonly count: number
  readonly getLabel: (row: T) => string
  /** 0-based place in the priority order, or -1. */
  readonly positionOf: (id: string) => number
  readonly move: (id: string, toIndex: number) => void
  readonly backToPriority: () => void
}

/** Pointer drags need a small move, touch drags a short press, so taps and scrolls still work. */
function usePrioritySensors(): ReturnType<typeof useSensors> {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

/**
 * Drag-and-drop for the rows on the visible page. It wraps the whole table,
 * not the body: dnd-kit renders its screen reader instructions as a div,
 * which may not sit inside a tbody.
 */
export function PriorityDndContext({
  priority,
  rowIds,
  children,
}: {
  readonly priority: Pick<RecordPriorityController<never>, "positionOf" | "move">
  readonly rowIds: readonly string[]
  readonly children: React.ReactNode
}): React.ReactElement {
  const contextId = React.useId()
  const sensors = usePrioritySensors()
  function dragEnd(event: DragEndEvent): void {
    const overId = event.over?.id
    if (overId === undefined || event.active.id === overId) return
    const to = priority.positionOf(String(overId))
    if (to >= 0) priority.move(String(event.active.id), to)
  }
  return (
    <DndContext
      id={contextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={dragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContext items={[...rowIds]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

type RowProps = Omit<React.ComponentProps<typeof TableRow>, "id"> & {
  readonly rowId: string
  readonly domId: string
}

/** A table row that can be dragged by its handle (see PriorityRowControls). */
export function SortableRecordRow({
  rowId,
  domId,
  disabled,
  className,
  style,
  children,
  ...props
}: RowProps & { readonly disabled: boolean }): React.ReactElement {
  const sortable = useSortable({ id: rowId, disabled })
  return (
    <SortableHandleContext.Provider value={sortable}>
      <TableRow
        {...props}
        id={domId}
        ref={sortable.setNodeRef}
        style={{ ...style, transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
        className={cn(className, sortable.isDragging && "relative z-10 bg-background shadow-md")}
      >
        {children}
      </TableRow>
    </SortableHandleContext.Provider>
  )
}

const SortableHandleContext = React.createContext<ReturnType<typeof useSortable> | null>(null)

/**
 * The leading cell of a priority row: its place in the order, a drag handle,
 * up/down arrows (keyboard and touch), and Move to top / bottom so a record
 * can cross pages.
 */
export function PriorityRowControls<T>({
  priority,
  row,
  rowId,
}: {
  readonly priority: RecordPriorityController<T>
  readonly row: T
  readonly rowId: string
}): React.ReactElement {
  const sortable = React.useContext(SortableHandleContext)
  const position = priority.positionOf(rowId)
  const label = priority.getLabel(row)
  const rank = <span className="w-7 text-right text-xs font-medium tabular-nums text-muted-foreground">{position + 1}</span>
  if (!priority.canReorder) {
    return <TableCell className="py-3 align-top">{rank}</TableCell>
  }
  const disabled = !priority.dragEnabled
  const last = priority.count - 1
  return (
    <TableCell className="py-2 align-top" data-row-click-ignore="">
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 touch-none cursor-grab active:cursor-grabbing"
          ref={sortable?.setActivatorNodeRef}
          {...sortable?.attributes}
          {...sortable?.listeners}
          disabled={disabled}
          aria-label={`Drag to reorder ${label}`}
        >
          <IconGripVertical className="size-4" />
        </Button>
        {rank}
        <div className="flex flex-col">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-4 w-6"
            disabled={disabled || position <= 0}
            aria-label={`Move ${label} up`}
            onClick={() => priority.move(rowId, position - 1)}
          >
            <IconArrowUp className="size-3" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-4 w-6"
            disabled={disabled || position >= last}
            aria-label={`Move ${label} down`}
            onClick={() => priority.move(rowId, position + 1)}
          >
            <IconArrowDown className="size-3" />
          </Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon" variant="ghost" className="size-7" disabled={disabled}>
              <IconDotsVertical className="size-4" />
              <span className="sr-only">More order actions for {label}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={position <= 0} onSelect={() => priority.move(rowId, 0)}>
              <IconArrowBarToUp className="size-4" /> Move to top
            </DropdownMenuItem>
            <DropdownMenuItem disabled={position >= last} onSelect={() => priority.move(rowId, last)}>
              <IconArrowBarToDown className="size-4" /> Move to bottom
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TableCell>
  )
}

/** The line above a priority table: how to reorder, or why it's paused. */
export function PriorityOrderStatus<T>({ priority }: { readonly priority: RecordPriorityController<T> }): React.ReactElement {
  const message = priority.pending
    ? `Saving ${priority.label.toLowerCase()}…`
    : !priority.inPriorityView
      ? `Sorted by ${priority.sortedBy ?? "a column"}. Go back to the ${priority.label.toLowerCase()} to change it.`
      : priority.searching
        ? `Showing search results in ${priority.label.toLowerCase()}. Clear the search to change the order.`
        : priority.canReorder
          ? `Shown in ${priority.label.toLowerCase()}. Drag the handle, use the arrows, or move a record to the top or bottom. Changes save automatically.`
          : `Shown in ${priority.label.toLowerCase()}.`
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-muted px-3 py-1.5">
      <p className="text-xs text-muted-foreground">{message}</p>
      {!priority.inPriorityView && (
        <Button type="button" size="sm" variant="outline" onClick={priority.backToPriority}>
          Back to priority order
        </Button>
      )}
      <p className="sr-only" aria-live="polite" role="status">
        {priority.announcement}
      </p>
    </div>
  )
}
