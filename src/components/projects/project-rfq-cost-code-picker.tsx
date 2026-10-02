"use client"

import * as React from "react"

import type { ProjectRfqCostCodeOption } from "@/app/actions/project-operations"
import {
  SearchableCombobox,
  type SearchableComboboxOption,
} from "@/components/searchable-combobox"

const NO_COST_CODE = "__rfq_no_cost_code__"
const NO_DIVISION = "__rfq_no_division__"

export function ProjectRfqDivisionPicker({
  value,
  options,
  rowNumber,
  onValueChange,
}: {
  readonly value: string
  readonly options: readonly ProjectRfqCostCodeOption[]
  readonly rowNumber: number
  readonly onValueChange: (value: string) => void
}): React.ReactElement {
  const divisionMap = new Map(options.map((option) => [
    option.divisionCode,
    option.divisionLabel,
  ]))
  const unmatchedDivision = value.length > 0 && !divisionMap.has(value)
  const choices: readonly SearchableComboboxOption[] = [
    { value: NO_DIVISION, label: "No division" },
    ...[...divisionMap].map(([divisionCode, divisionLabel]) => ({
      value: divisionCode,
      label: divisionLabel,
    })),
  ]
  const visibleChoices = unmatchedDivision
    ? [{ value, label: `${value} · not a Sage division` }, ...choices]
    : choices

  return (
    <div className="min-w-0">
      <SearchableCombobox
        value={value}
        options={visibleChoices}
        onValueChange={(nextValue) =>
          onValueChange(nextValue === NO_DIVISION ? "" : nextValue)
        }
        ariaLabel={`Choose Sage division for RFQ scope row ${rowNumber}`}
        placeholder="Division"
        searchPlaceholder="Search Sage divisions..."
        emptyMessage="No matching Sage divisions."
        className="h-8 rounded-none border-0 bg-transparent px-1 text-xs shadow-none hover:bg-background"
      />
      {unmatchedDivision && (
        <p className="px-1 pt-1 text-xs text-destructive">
          Choose a Sage division for new scope.
        </p>
      )}
    </div>
  )
}

export function ProjectRfqCostCodePicker({
  value,
  options,
  divisionCode,
  rowNumber,
  onValueChange,
}: {
  readonly value: string
  readonly options: readonly ProjectRfqCostCodeOption[]
  readonly divisionCode: string
  readonly rowNumber: number
  readonly onValueChange: (value: string) => void
}): React.ReactElement {
  const selectedCode = options.find((option) => option.value === value)
  const unmatchedCode = value.length > 0 && !selectedCode
  const matchingDivision = divisionCode.length > 0 &&
    options.some((option) => option.divisionCode === divisionCode)
  const availableOptions = matchingDivision
    ? options.filter((option) => option.divisionCode === divisionCode)
    : options
  const mismatchedDivision = selectedCode !== undefined && divisionCode.length > 0 &&
    selectedCode.divisionCode !== divisionCode
  const choices: readonly SearchableComboboxOption[] = [
    { value: NO_COST_CODE, label: "No cost code" },
    ...availableOptions.map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description,
      keywords: `${option.divisionCode} ${option.divisionLabel}`,
    })),
  ]
  const visibleChoices = unmatchedCode
    ? [
        {
          value,
          label: `${value} · not active in Sage`,
          selectedLabel: value,
          description: "Choose an active Sage cost code to replace this one.",
        },
        ...choices,
      ]
    : mismatchedDivision && selectedCode
      ? [{
          value: selectedCode.value,
          label: selectedCode.label,
          description: selectedCode.description,
        }, ...choices]
      : choices

  return (
    <div className="min-w-0">
      <SearchableCombobox
        value={value}
        options={visibleChoices}
        onValueChange={(nextValue) =>
          onValueChange(nextValue === NO_COST_CODE ? "" : nextValue)
        }
        ariaLabel={`Choose Sage cost code for RFQ scope row ${rowNumber}`}
        placeholder="Choose cost code"
        searchPlaceholder="Search Sage cost codes..."
        emptyMessage="No matching Sage cost codes."
        className="h-8 rounded-none border-0 bg-transparent px-1 text-xs shadow-none hover:bg-background"
      />
      {unmatchedCode && (
        <p className="px-1 pt-1 text-xs text-destructive">
          This code is not active in Sage. Choose a current code for new scope.
        </p>
      )}
      {mismatchedDivision && selectedCode && (
        <p className="px-1 pt-1 text-xs text-destructive">
          This code belongs to division {selectedCode.divisionCode}.
        </p>
      )}
    </div>
  )
}
