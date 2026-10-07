"use client"

import { useEffect, useId, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { IconArrowDown, IconArrowUp, IconGripVertical, IconSortAscending } from "@tabler/icons-react"
import { toast } from "sonner"
import { reorderProjectEstimateLines } from "@/app/actions/estimate-line-order"
import type { ProjectEstimateLineItem } from "@/app/actions/project-estimates"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { sameEstimateLineOrder, sortEstimateLinesByCostCode, type EstimateLineOrderGroup } from "@/lib/estimates/line-order"

function SortableEstimateItem({ item, index, count, disabled, move, children }: {
  readonly item: ProjectEstimateLineItem
  readonly index: number
  readonly count: number
  readonly disabled: boolean
  readonly move: (from: number, to: number) => void
  readonly children: ReactNode
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled })
  const label = `${item.costCode} · ${item.description}`
  return (
    <div ref={setNodeRef} data-estimate-line-id={item.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative grid grid-cols-[auto_minmax(0,1fr)] bg-background", isDragging && "z-10 shadow-md")}>
      <div className="flex flex-col items-center gap-0.5 pt-3 pl-1">
        <Button type="button" size="icon" variant="ghost" className="size-8 touch-none cursor-grab active:cursor-grabbing"
          ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled}
          aria-label={`Drag to reorder ${label}`}>
          <IconGripVertical className="size-4" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" disabled={disabled || index === 0}
          aria-label={`Move ${label} up`} onClick={() => move(index, index - 1)}>
          <IconArrowUp className="size-4" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" disabled={disabled || index === count - 1}
          aria-label={`Move ${label} down`} onClick={() => move(index, index + 1)}>
          <IconArrowDown className="size-4" />
        </Button>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function ProjectEstimateLineOrder({ projectId, estimateId, updatedAt, group, groupName, items, editable, renderItem }: {
  readonly projectId: string
  readonly estimateId: string
  readonly updatedAt: string
  readonly group: EstimateLineOrderGroup
  readonly groupName: string
  readonly items: readonly ProjectEstimateLineItem[]
  readonly editable: boolean
  readonly renderItem: (item: ProjectEstimateLineItem) => ReactNode
}): React.ReactElement {
  const router = useRouter()
  const contextId = useId()
  const [orderedItems, setOrderedItems] = useState(items)
  const [pending, startTransition] = useTransition()
  useEffect(() => { setOrderedItems(items) }, [items])
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  function save(next: readonly ProjectEstimateLineItem[]): void {
    if (pending || !editable) return
    const previousIds = items.map((item) => item.id)
    const orderedIds = next.map((item) => item.id)
    if (sameEstimateLineOrder(previousIds, orderedIds)) return
    setOrderedItems(next)
    startTransition(async () => {
      try {
        const result = await reorderProjectEstimateLines(projectId, estimateId, {
          group, expectedUpdatedAt: updatedAt, previousIds, orderedIds,
        })
        if (!result.success) {
          setOrderedItems(items)
          toast.error(result.error)
          return
        }
        toast.success("Item order saved")
        router.refresh()
      } catch {
        setOrderedItems(items)
        toast.error("Unable to save item order. Try again.")
      }
    })
  }
  function move(from: number, to: number): void {
    if (to >= 0 && to < orderedItems.length) save(arrayMove([...orderedItems], from, to))
  }
  function dragEnd(event: DragEndEvent): void {
    if (!event.over || event.active.id === event.over.id) return
    const from = orderedItems.findIndex((item) => item.id === event.active.id)
    const to = orderedItems.findIndex((item) => item.id === event.over?.id)
    if (from >= 0 && to >= 0) move(from, to)
  }
  if (!editable) return <div className="divide-y">{items.map((item) => <div key={item.id} data-estimate-line-id={item.id}>{renderItem(item)}</div>)}</div>
  return (
    <div role="group" aria-label={`${groupName} items`} aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {pending ? "Saving item order…" : "Drag the handle or use the arrows to reorder. Changes save automatically."}
        </p>
        <Button type="button" size="sm" variant="ghost" disabled={pending || items.length < 2}
          aria-label={`Sort ${groupName} by cost code`} onClick={() => save(sortEstimateLinesByCostCode(orderedItems))}>
          <IconSortAscending className="size-4" /> Sort by cost code
        </Button>
      </div>
      <DndContext id={contextId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
        <SortableContext items={orderedItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <div className="divide-y">
            {orderedItems.map((item, index) => <SortableEstimateItem key={item.id} item={item} index={index}
              count={orderedItems.length} disabled={pending || orderedItems.length < 2} move={move}>
              {renderItem(item)}
            </SortableEstimateItem>)}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
