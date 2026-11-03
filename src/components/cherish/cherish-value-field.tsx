"use client"

import type { CherishValue } from "@/app/actions/cherish-pulse"
import { SearchableCombobox } from "@/components/searchable-combobox"

const CHERISH_VALUE_OPTIONS: readonly CherishValue[] = [
  "Camaraderie",
  "Honor",
  "Excellence",
  "Reliability",
  "Integrity",
  "Servitude",
  "Humility",
]

/**
 * The CHERISH value for a response. Nothing is chosen up front: once the
 * person writes, Compass suggests the value that fits and they can change it.
 */
export function CherishValueField({
  id,
  value,
  suggested,
  chosen,
  hasMessage,
  onChoose,
}: {
  readonly id: string
  readonly value: CherishValue | null
  readonly suggested: CherishValue | null
  readonly chosen: boolean
  readonly hasMessage: boolean
  readonly onChoose: (value: CherishValue | null) => void
}): React.ReactElement {
  const hint = chosen
    ? null
    : suggested
      ? `Suggested: ${suggested}. Change it if another value fits better.`
      : hasMessage
        ? "Choose the value that fits best."
        : "Write your message, and Compass will suggest a value."
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">CHERISH value</label>
      <SearchableCombobox
        value={value ?? ""}
        onValueChange={(next) => {
          onChoose(CHERISH_VALUE_OPTIONS.find((candidate) => candidate === next) ?? null)
        }}
        options={CHERISH_VALUE_OPTIONS.map((option) => ({ value: option, label: option }))}
        ariaLabel="CHERISH value"
        ariaDescribedBy={hint ? `${id}-hint` : undefined}
        placeholder="Choose a value"
        searchPlaceholder="Search values..."
        emptyMessage="No matching values."
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
