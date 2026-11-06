"use client"

import * as React from "react"
import {
  closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { IconCaretDownFilled, IconCaretUpFilled, IconGripVertical, IconSortAscending } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/*
 * Line items inside one record (estimate, P.O., RFQ, change order, shop
 * ticket, invoice) reorder with this one control: a slim drag handle with
 * small up and down arrows beside it (ui-standards.md "Line item order").
 * The parent owns the order; each move calls `onMove(from, to)`. Give the
 * handle's cell a 2.75rem grid track (or table column) as the row's first.
 */

type RowsContext = {
  readonly count: number
  readonly disabled: boolean
  readonly move: (from: number, to: number) => void
}

type RowContext = {
  readonly index: number
  readonly handle: Pick<ReturnType<typeof useSortable>, "attributes" | "listeners" | "setActivatorNodeRef">
}

const SortableRowsContext = React.createContext<RowsContext | null>(null)
const SortableRowContext = React.createContext<RowContext | null>(null)

/**
 * The rows of one list. Children are `SortableRow`s (or `SortableTableRow`s)
 * in order; it renders no element of its own, so it can sit inside a `<tbody>`.
 */
export function SortableRows({ ids, onMove, disabled = false, children }: {
  /** Row ids in their current order. */
  readonly ids: readonly string[]
  readonly onMove: (from: number, to: number) => void
  readonly disabled?: boolean
  readonly children: React.ReactNode
}): React.ReactElement {
  const contextId = React.useId()
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const count = ids.length
  const locked = disabled || count < 2
  const move = React.useCallback((from: number, to: number) => {
    if (!locked && from !== to && from >= 0 && to >= 0 && from < count && to < count) onMove(from, to)
  }, [count, locked, onMove])
  function dragEnd(event: DragEndEvent): void {
    if (!event.over || event.active.id === event.over.id) return
    move(ids.indexOf(String(event.active.id)), ids.indexOf(String(event.over.id)))
  }
  const value = React.useMemo(() => ({ count, disabled: locked, move }), [count, locked, move])
  return (
    <SortableRowsContext.Provider value={value}>
      <DndContext id={contextId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
        <SortableContext items={[...ids]} strategy={verticalListSortingStrategy} disabled={locked}>
          {children}
        </SortableContext>
      </DndContext>
    </SortableRowsContext.Provider>
  )
}

function useRow(id: string, index: number): {
  readonly ref: (node: HTMLElement | null) => void
  readonly style: React.CSSProperties
  readonly dragging: boolean
  readonly context: RowContext
} {
  const rows = React.useContext(SortableRowsContext)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: rows?.disabled ?? true })
  const context = React.useMemo(
    () => ({ index, handle: { attributes, listeners, setActivatorNodeRef } }),
    [index, attributes, listeners, setActivatorNodeRef],
  )
  return {
    ref: setNodeRef,
    style: { transform: CSS.Translate.toString(transform), transition },
    dragging: isDragging,
    context,
  }
}

const DRAGGING = "relative z-10 bg-background shadow-md"

/** One reorderable row; lay it out with `className` and put a `ReorderHandle` in its first cell. */
export function SortableRow({ id, index, className, children, ...rest }: {
  readonly id: string
  readonly index: number
  readonly className?: string
  readonly children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, "id" | "className" | "children" | "style">): React.ReactElement {
  const row = useRow(id, index)
  return (
    <SortableRowContext.Provider value={row.context}>
      <div {...rest} ref={row.ref} style={row.style} data-sortable-row={id} className={cn(className, row.dragging && DRAGGING)}>
        {children}
      </div>
    </SortableRowContext.Provider>
  )
}

/** `SortableRow` for a `<tbody>`: put a `ReorderHandle` in the first `<td>`. */
export function SortableTableRow({ id, index, className, children, ...rest }: {
  readonly id: string
  readonly index: number
  readonly className?: string
  readonly children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLTableRowElement>, "id" | "className" | "children" | "style">): React.ReactElement {
  const row = useRow(id, index)
  return (
    <SortableRowContext.Provider value={row.context}>
      <tr {...rest} ref={row.ref} style={row.style} data-sortable-row={id} className={cn(className, row.dragging && DRAGGING)}>
        {children}
      </tr>
    </SortableRowContext.Provider>
  )
}

/** The handle: drag it, or use the small arrows beside it (phones and keyboards). */
export function ReorderHandle({ label }: {
  /** Names the row, such as "line 3" or "02-200 · Excavation". */
  readonly label: string
}): React.ReactElement | null {
  const rows = React.useContext(SortableRowsContext)
  const row = React.useContext(SortableRowContext)
  if (!rows || !row) return null
  const { index, handle } = row
  const arrow = "flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" ref={handle.setActivatorNodeRef} {...handle.attributes} {...handle.listeners}
        disabled={rows.disabled} aria-label={`Drag to reorder ${label}`}
        className="flex h-8 w-5 touch-none cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-default disabled:opacity-30">
        <IconGripVertical className="size-4" />
      </button>
      <div className="flex flex-col">
        <button type="button" className={arrow} disabled={rows.disabled || index === 0}
          aria-label={`Move ${label} up`} onClick={() => rows.move(index, index - 1)}>
          <IconCaretUpFilled className="size-3" />
        </button>
        <button type="button" className={arrow} disabled={rows.disabled || index === rows.count - 1}
          aria-label={`Move ${label} down`} onClick={() => rows.move(index, index + 1)}>
          <IconCaretDownFilled className="size-3" />
        </button>
      </div>
    </div>
  )
}

/** Puts a list's rows in cost-code order in one click. */
export function SortByCostCodeButton({ onSort, disabled = false, label = "lines" }: {
  readonly onSort: () => void
  readonly disabled?: boolean
  readonly label?: string
}): React.ReactElement {
  return (
    <Button type="button" size="sm" variant="ghost" disabled={disabled}
      aria-label={`Sort ${label} by cost code`} onClick={onSort}>
      <IconSortAscending className="size-4" /> Sort by cost code
    </Button>
  )
}
