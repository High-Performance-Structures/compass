"use client"

import * as React from "react"
import { IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatDollars } from "@/lib/format"
import {
  lineAmount,
  lineItemsSubtotal,
  parseLineNumber,
  type LineItem,
} from "@/lib/domain/financials/rules"
import { useIsMobile } from "@/hooks/use-mobile"
import { ReorderHandle, SortableRow, SortableRows } from "@/components/ui/sortable-rows"
import { moveLine } from "@/lib/shared/line-order"

interface LineItemsEditorProps {
  value: LineItem[]
  onChange: (items: LineItem[]) => void
}

export function LineItemsEditor({ value, onChange }: LineItemsEditorProps) {
  const isMobile = useIsMobile()
  // Line items carry no id, so rows keep a local key that moves with them.
  const nextKey = React.useRef(0)
  const [keys, setKeys] = React.useState<readonly string[]>(() =>
    value.map(() => `line-${nextKey.current++}`)
  )
  const rowKeys = keys.length === value.length
    ? keys
    : value.map((_, index) => keys[index] ?? `line-new-${index}`)

  const addLine = () => {
    setKeys([...rowKeys, `line-${nextKey.current++}`])
    onChange([...value, { description: "", quantity: 1, rate: 0, amount: 0 }])
  }

  const removeLine = (index: number) => {
    setKeys(rowKeys.filter((_, i) => i !== index))
    onChange(value.filter((_, i) => i !== index))
  }

  const moveRow = (from: number, to: number) => {
    setKeys(moveLine(rowKeys, from, to))
    onChange([...moveLine(value, from, to)])
  }

  const updateLine = (
    index: number,
    field: keyof LineItem,
    raw: string
  ) => {
    const updated = value.map((item, i) => {
      if (i !== index) return item
      const next = { ...item }
      if (field === "description") {
        next.description = raw
      } else if (field === "quantity") {
        next.quantity = parseLineNumber(raw)
        next.amount = lineAmount(next.quantity, next.rate)
      } else if (field === "rate") {
        next.rate = parseLineNumber(raw)
        next.amount = lineAmount(next.quantity, next.rate)
      }
      return next
    })
    onChange(updated)
  }

  const subtotal = lineItemsSubtotal(value)

  // Mobile: card-based layout
  if (isMobile) {
    return (
      <div className="space-y-3">
        <SortableRows ids={rowKeys} onMove={moveRow}>
        {value.map((item, index) => (
          <SortableRow
            key={rowKeys[index]}
            id={rowKeys[index] ?? String(index)}
            index={index}
            className="rounded-md border bg-background p-3 space-y-2.5 relative"
          >
            <ReorderHandle label={`line ${index + 1}`} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 size-7"
              onClick={() => removeLine(index)}
            >
              <IconX className="size-3.5" />
            </Button>

            <div className="space-y-1.5 pr-8">
              <Label className="text-xs">Description</Label>
              <Input
                value={item.description}
                onChange={(e) => updateLine(index, "description", e.target.value)}
                placeholder="Item description"
                className="h-9 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label className="text-xs">Qty</Label>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={item.quantity || ""}
                  onChange={(e) => updateLine(index, "quantity", e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Rate</Label>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={item.rate || ""}
                  onChange={(e) => updateLine(index, "rate", e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 text-xs">
              <span className="text-muted-foreground">Amount:</span>
              <span className="font-semibold">{formatDollars(item.amount)}</span>
            </div>
          </SortableRow>
        ))}
        </SortableRows>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addLine}
          className="w-full h-9"
        >
          <IconPlus className="mr-2 size-4" />
          Add Line Item
        </Button>

        <div className="flex items-center justify-between pt-2 text-sm border-t">
          <span className="font-medium">Subtotal:</span>
          <span className="font-semibold">{formatDollars(subtotal)}</span>
        </div>
      </div>
    )
  }

  // Desktop: table layout
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[2.75rem_1fr_80px_100px_100px_32px] gap-2 text-xs font-medium text-muted-foreground">
        <span />
        <span>Description</span>
        <span>Qty</span>
        <span>Rate</span>
        <span>Amount</span>
        <span />
      </div>
      <SortableRows ids={rowKeys} onMove={moveRow}>
      {value.map((item, index) => (
        <SortableRow
          key={rowKeys[index]}
          id={rowKeys[index] ?? String(index)}
          index={index}
          className="grid grid-cols-[2.75rem_1fr_80px_100px_100px_32px] gap-2 items-center bg-background"
        >
          <ReorderHandle label={`line ${index + 1}`} />
          <Input
            value={item.description}
            onChange={(e) => updateLine(index, "description", e.target.value)}
            placeholder="Line item description"
            className="h-9"
          />
          <Input
            type="number"
            min={0}
            step="any"
            value={item.quantity || ""}
            onChange={(e) => updateLine(index, "quantity", e.target.value)}
            className="h-9"
          />
          <Input
            type="number"
            min={0}
            step="any"
            value={item.rate || ""}
            onChange={(e) => updateLine(index, "rate", e.target.value)}
            className="h-9"
          />
          <span className="text-sm px-2">{formatDollars(item.amount)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => removeLine(index)}
          >
            <IconX className="size-4" />
          </Button>
        </SortableRow>
      ))}
      </SortableRows>
      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="outline" size="sm" onClick={addLine} className="h-9">
          <IconPlus className="mr-1 size-4" />
          Add Line
        </Button>
        <span className="text-sm font-medium">
          Subtotal: {formatDollars(subtotal)}
        </span>
      </div>
    </div>
  )
}
