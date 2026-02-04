"use client"

import * as React from "react"
import { IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"

export type LineItem = {
  description: string
  quantity: number
  rate: number
  amount: number
}

interface LineItemsEditorProps {
  value: LineItem[]
  onChange: (items: LineItem[]) => void
}

export function LineItemsEditor({ value, onChange }: LineItemsEditorProps) {
  const isMobile = useIsMobile()

  const addLine = () => {
    onChange([...value, { description: "", quantity: 1, rate: 0, amount: 0 }])
  }

  const removeLine = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
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
        next.quantity = parseFloat(raw) || 0
        next.amount = next.quantity * next.rate
      } else if (field === "rate") {
        next.rate = parseFloat(raw) || 0
        next.amount = next.quantity * next.rate
      }
      return next
    })
    onChange(updated)
  }

  const subtotal = value.reduce((sum, item) => sum + item.amount, 0)

  // Mobile: card-based layout
  if (isMobile) {
    return (
      <div className="space-y-3">
        {value.map((item, index) => (
          <div
            key={index}
            className="rounded-md border p-3 space-y-2.5 relative"
          >
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
              <span className="font-semibold">{formatCurrency(item.amount)}</span>
            </div>
          </div>
        ))}

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
          <span className="font-semibold">{formatCurrency(subtotal)}</span>
        </div>
      </div>
    )
  }

  // Desktop: table layout
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 text-xs font-medium text-muted-foreground">
        <span>Description</span>
        <span>Qty</span>
        <span>Rate</span>
        <span>Amount</span>
        <span />
      </div>
      {value.map((item, index) => (
        <div
          key={index}
          className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 items-center"
        >
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
          <span className="text-sm px-2">{formatCurrency(item.amount)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => removeLine(index)}
          >
            <IconX className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="outline" size="sm" onClick={addLine} className="h-9">
          <IconPlus className="mr-1 size-4" />
          Add Line
        </Button>
        <span className="text-sm font-medium">
          Subtotal: {formatCurrency(subtotal)}
        </span>
      </div>
    </div>
  )
}
