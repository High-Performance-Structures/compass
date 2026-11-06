"use client"

import type { ReactNode } from "react"
import { ReorderHandle, SortableRow, SortableRows } from "@/components/ui/sortable-rows"
import { moveLine } from "@/lib/shared/line-order"

/**
 * A vertical list people can reorder by dragging the handle or with the
 * up/down arrows (keyboard dragging works too). The parent owns the order and
 * persists it from onReorder. Built on the shared line-order control
 * (ui-standards.md "Line item order").
 */
export function SortableList<T extends { readonly id: string }>({ items, label, disabled = false, onReorder, renderItem, className }: {
  readonly items: readonly T[]
  readonly label: (item: T) => string
  readonly disabled?: boolean
  readonly onReorder: (next: readonly T[]) => void
  readonly renderItem: (item: T, index: number) => ReactNode
  readonly className?: string
}): React.ReactElement {
  return (
    <div className={className}>
      <SortableRows ids={items.map((item) => item.id)} disabled={disabled}
        onMove={(from, to) => onReorder(moveLine(items, from, to))}>
        {items.map((item, index) => (
          <SortableRow key={item.id} id={item.id} index={index}
            className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] items-center bg-background">
            <div className="pl-1">
              <ReorderHandle label={label(item)} />
            </div>
            <div className="min-w-0">{renderItem(item, index)}</div>
          </SortableRow>
        ))}
      </SortableRows>
    </div>
  )
}
