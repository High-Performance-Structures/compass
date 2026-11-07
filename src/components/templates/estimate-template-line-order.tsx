"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { reorderEstimateTemplateLines, type EstimateTemplateEditorLine } from "@/app/actions/estimate-templates"
import {
  ReorderHandle, SortableRow, SortableRows, SortByCostCodeButton,
} from "@/components/ui/sortable-rows"
import { moveLine } from "@/lib/shared/line-order"
import { sameEstimateLineOrder, sortEstimateLinesByCostCode } from "@/lib/estimates/line-order"

/** One CSI division's template lines; each move saves at once, like estimate items. */
export function EstimateTemplateLineOrder({ templateId, divisionCode, groupName, items, editable, renderItem }: {
  readonly templateId: string
  readonly divisionCode: string
  readonly groupName: string
  readonly items: readonly EstimateTemplateEditorLine[]
  readonly editable: boolean
  readonly renderItem: (item: EstimateTemplateEditorLine) => ReactNode
}): React.ReactElement {
  const router = useRouter()
  const [orderedItems, setOrderedItems] = useState(items)
  const [pending, startTransition] = useTransition()
  useEffect(() => { setOrderedItems(items) }, [items])
  function save(next: readonly EstimateTemplateEditorLine[]): void {
    if (pending || !editable) return
    const previousIds = items.map((item) => item.id)
    const orderedIds = next.map((item) => item.id)
    if (sameEstimateLineOrder(previousIds, orderedIds)) return
    setOrderedItems(next)
    startTransition(async () => {
      const result = await reorderEstimateTemplateLines(templateId, { divisionCode, previousIds, orderedIds })
      if (!result.success) {
        setOrderedItems(items)
        toast.error(result.error)
        return
      }
      toast.success("Line order saved")
      router.refresh()
    })
  }
  function move(from: number, to: number): void {
    save(moveLine(orderedItems, from, to))
  }
  if (!editable) return <div className="divide-y">{items.map((item) => <div key={item.id}>{renderItem(item)}</div>)}</div>
  return (
    <div role="group" aria-label={`${groupName} lines`} aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {pending ? "Saving line order…" : "Drag the handle or use the arrows to reorder. Changes save automatically."}
        </p>
        <SortByCostCodeButton label={groupName} disabled={pending || items.length < 2}
          onSort={() => save(sortEstimateLinesByCostCode(orderedItems))} />
      </div>
      <div className="divide-y">
        <SortableRows ids={orderedItems.map((item) => item.id)} onMove={move} disabled={pending}>
          {orderedItems.map((item, index) => (
            <SortableRow key={item.id} id={item.id} index={index}
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
