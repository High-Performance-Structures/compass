"use client"

import * as React from "react"
import { IconColumns3 } from "@tabler/icons-react"

import type { ListSheetControl } from "@/components/list-sheets/use-list-sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * A sheet's Columns button: each person shows or hides columns for
 * themselves, or goes back to the company default. The column that opens the
 * record always shows.
 */
export function RecordColumnsButton({
  sheet,
  availableColumnIds,
}: {
  readonly sheet: ListSheetControl
  /** Columns this table really has (some depend on who is looking). */
  readonly availableColumnIds: readonly string[]
}): React.ReactElement {
  const available = new Set(availableColumnIds)
  const columns = sheet.layout.columns.filter((column) => available.has(column.id))
  const idPrefix = React.useId()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8">
          <IconColumns3 aria-hidden className="size-4" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">Columns</p>
          <p className="text-xs text-muted-foreground">Only you see these changes.</p>
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto px-3 py-2" aria-label={`${sheet.definition.label} columns`}>
          {columns.map((column) => {
            const id = `${idPrefix}-${column.id}`
            return (
              <li key={column.id} className="flex items-center gap-2 py-0.5">
                <Checkbox
                  id={id}
                  checked={column.visible}
                  disabled={column.required === true}
                  onCheckedChange={(checked) => sheet.setColumnVisible(column.id, checked === true)}
                />
                <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                  {column.label}
                  {column.required === true && <span className="block text-xs text-muted-foreground">Always shown</span>}
                </label>
              </li>
            )
          })}
        </ul>
        <div className="border-t px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start"
            disabled={!sheet.layout.personalized}
            onClick={sheet.resetToCompany}
          >
            Reset to company default
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
