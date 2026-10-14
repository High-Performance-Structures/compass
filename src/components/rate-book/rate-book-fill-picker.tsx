"use client"

import { useEffect, useState, type ReactElement } from "react"

import type { RateBookPickerOption } from "@/app/actions/rate-book"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Label } from "@/components/ui/label"
import { loadRateBookPicker } from "@/lib/rate-book/picker-cache"

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * "From rate book": fills a form from an accepted rate. The filled fields stay
 * editable, so a rate can be overridden for the job at hand. Hidden when the
 * rate book is empty.
 */
export function RateBookFillPicker({
  id,
  projectId,
  onPick,
  disabled = false,
  className,
}: {
  readonly id: string
  /** The job, for its zone charges; null for templates. */
  readonly projectId: string | null
  readonly onPick: (option: RateBookPickerOption) => void
  readonly disabled?: boolean
  readonly className?: string
}): ReactElement | null {
  const [options, setOptions] = useState<readonly RateBookPickerOption[]>([])
  const [picked, setPicked] = useState("")
  useEffect(() => {
    let cancelled = false
    void loadRateBookPicker(projectId).then((loaded) => {
      if (!cancelled) setOptions(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])
  if (options.length === 0) return null
  return (
    <div className={className ?? "space-y-1.5"}>
      <Label htmlFor={id}>From rate book</Label>
      <SearchableCombobox
        id={id}
        value={picked}
        onValueChange={(value) => {
          // The picker reports "" when it resets; keep the form as is.
          const option = options.find((candidate) => candidate.id === value)
          if (!option) return
          setPicked(option.id)
          onPick(option)
        }}
        options={options.map((option) => ({
          value: option.id,
          label: option.label,
          description: `${option.group} · ${money(option.unitCostCents)}/${option.unit}`,
          keywords: `${option.group} ${option.costCode ?? ""}`,
        }))}
        ariaLabel="Fill from the rate book"
        placeholder="Choose a rate to fill this item"
        searchPlaceholder="Search rates..."
        emptyMessage="No matching rates."
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">Fills unit, cost and markup. You can still change them for this job.</p>
    </div>
  )
}
