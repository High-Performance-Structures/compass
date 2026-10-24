"use client"

import type * as React from "react"

import { Checkbox } from "@/components/ui/checkbox"

/**
 * The contract assemblies a change-order estimate starts from. Lines added
 * or credited in them land in that assembly on the budget and pay
 * applications; new scope goes in a new assembly in the estimate editor.
 */
export function ContractAssemblyChecklist({
  assemblies,
  selected,
  onSelectedChange,
  disabled,
}: {
  readonly assemblies: readonly { readonly id: string; readonly name: string }[]
  readonly selected: readonly string[]
  readonly onSelectedChange: (ids: readonly string[]) => void
  readonly disabled: boolean
}): React.ReactElement | null {
  if (assemblies.length === 0) return null
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-muted-foreground">Contract assemblies this change adds to or reduces</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {assemblies.map((assembly) => (
          <label key={assembly.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.includes(assembly.id)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onSelectedChange(
                  checked === true
                    ? [...selected, assembly.id]
                    : selected.filter((id) => id !== assembly.id)
                )
              }
            />
            {assembly.name}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        New scope that isn&apos;t part of an existing assembly can go in a new assembly in the estimate.
      </p>
    </fieldset>
  )
}
