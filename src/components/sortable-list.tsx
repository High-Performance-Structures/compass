"use client"

import { useId, type ReactNode } from "react"
import {
  closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { IconArrowDown, IconArrowUp, IconGripVertical } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function SortableRow({ id, label, index, count, disabled, move, children }: {
  readonly id: string
  readonly label: string
  readonly index: number
  readonly count: number
  readonly disabled: boolean
  readonly move: (from: number, to: number) => void
  readonly children: ReactNode
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative grid grid-cols-[auto_minmax(0,1fr)] items-center bg-background", isDragging && "z-10 shadow-md")}>
      <div className="flex items-center gap-0.5 pl-1">
        <Button type="button" size="icon" variant="ghost" className="size-7 touch-none cursor-grab active:cursor-grabbing"
          ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled}
          aria-label={`Drag to reorder ${label}`}>
          <IconGripVertical className="size-4" />
        </Button>
        <div className="flex flex-col">
          <Button type="button" size="icon" variant="ghost" className="h-4 w-6" disabled={disabled || index === 0}
            aria-label={`Move ${label} up`} onClick={() => move(index, index - 1)}>
            <IconArrowUp className="size-3" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-4 w-6" disabled={disabled || index === count - 1}
            aria-label={`Move ${label} down`} onClick={() => move(index, index + 1)}>
            <IconArrowDown className="size-3" />
          </Button>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/**
 * A vertical list people can reorder by dragging the handle or with the
 * up/down arrows (keyboard dragging works too). The parent owns the order and
 * persists it from onReorder.
 */
export function SortableList<T extends { readonly id: string }>({ items, label, disabled = false, onReorder, renderItem, className }: {
  readonly items: readonly T[]
  readonly label: (item: T) => string
  readonly disabled?: boolean
  readonly onReorder: (next: readonly T[]) => void
  readonly renderItem: (item: T, index: number) => ReactNode
  readonly className?: string
}): React.ReactElement {
  const contextId = useId()
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  function move(from: number, to: number): void {
    if (to >= 0 && to < items.length && from !== to) onReorder(arrayMove([...items], from, to))
  }
  function dragEnd(event: DragEndEvent): void {
    if (!event.over || event.active.id === event.over.id) return
    const from = items.findIndex((item) => item.id === event.active.id)
    const to = items.findIndex((item) => item.id === event.over?.id)
    if (from >= 0 && to >= 0) move(from, to)
  }
  return (
    <DndContext id={contextId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className={className}>
          {items.map((item, index) => (
            <SortableRow key={item.id} id={item.id} label={label(item)} index={index} count={items.length}
              disabled={disabled || items.length < 2} move={move}>
              {renderItem(item, index)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
