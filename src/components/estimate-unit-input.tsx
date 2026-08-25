"use client"

import { Input } from "@/components/ui/input"

const STANDARD_ESTIMATE_UNITS = [
  { value: "EA", label: "Each" },
  { value: "LS", label: "Lump sum" },
  { value: "LOT", label: "Lot" },
  { value: "LF", label: "Linear foot" },
  { value: "SF", label: "Square foot" },
  { value: "SY", label: "Square yard" },
  { value: "CF", label: "Cubic foot" },
  { value: "CY", label: "Cubic yard" },
  { value: "AC", label: "Acre" },
  { value: "IN", label: "Inch" },
  { value: "FT", label: "Foot" },
  { value: "YD", label: "Yard" },
  { value: "MI", label: "Mile" },
  { value: "BF", label: "Board foot" },
  { value: "MBF", label: "Thousand board feet" },
  { value: "LB", label: "Pound" },
  { value: "TON", label: "Ton" },
  { value: "GAL", label: "Gallon" },
  { value: "HR", label: "Hour" },
  { value: "DAY", label: "Day" },
  { value: "WK", label: "Week" },
  { value: "MO", label: "Month" },
] as const

export function EstimateUnitInput({
  id,
  name,
  value,
  disabled = false,
  onValueChange,
}: {
  readonly id: string
  readonly name?: string
  readonly value: string
  readonly disabled?: boolean
  readonly onValueChange: (value: string) => void
}): React.ReactElement {
  const listId = `${id}-options`

  return (
    <>
      <Input
        id={id}
        name={name}
        list={listId}
        value={value}
        placeholder="Select or type a unit"
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <datalist id={listId}>
        {STANDARD_ESTIMATE_UNITS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </datalist>
      <p className="text-xs text-muted-foreground">
        Choose a standard unit or type your own.
      </p>
    </>
  )
}
