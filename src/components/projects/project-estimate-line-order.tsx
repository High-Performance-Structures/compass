"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { reorderProjectEstimateLines } from "@/app/actions/estimate-line-order"
import type { ProjectEstimateLineItem } from "@/app/actions/project-estimates"
import {
  ReorderHandle, SortableRow, SortableRows, SortByCostCodeButton,
} from "@/components/ui/sortable-rows"
import { moveLine } from "@/lib/shared/line-order"
import { sameEstimateLineOrder, sortEstimateLinesByCostCode, type EstimateLineOrderGroup } from "@/lib/estimates/line-order"

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
  const [orderedItems, setOrderedItems] = useState(items)
  const [pending, startTransition] = useTransition()
  useEffect(() => { setOrderedItems(items) }, [items])
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
    save(moveLine(orderedItems, from, to))
  }
  if (!editable) return <div className="divide-y">{items.map((item) => <div key={item.id} data-estimate-line-id={item.id}>{renderItem(item)}</div>)}</div>
  return (
    <div role="group" aria-label={`${groupName} items`} aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {pending ? "Saving item order…" : "Drag the handle or use the arrows to reorder. Changes save automatically."}
        </p>
        <SortByCostCodeButton label={groupName} disabled={pending || items.length < 2}
          onSort={() => save(sortEstimateLinesByCostCode(orderedItems))} />
      </div>
      <div className="divide-y">
        <SortableRows ids={orderedItems.map((item) => item.id)} onMove={move} disabled={pending}>
          {orderedItems.map((item, index) => (
            <SortableRow key={item.id} id={item.id} index={index} data-estimate-line-id={item.id}
              className="grid grid-cols-[2.75rem_minmax(0,1fr)] bg-background">
              <div className="pt-3 pl-1">
                <ReorderHandle label={`${item.costCode} · ${item.description}`} />
              </div>
              <div className="min-w-0">{renderItem(item)}</div>
            </SortableRow>
          ))}
        </SortableRows>
      </div>
    </div>
  )
}
