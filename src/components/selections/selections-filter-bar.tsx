"use client"

/*
 * The one filter bar for the Selections page's Publish to owner, Finish
 * specs and Print & share areas: search, room, division and cost code, with
 * a "Showing N of M" line. Switching areas keeps the filter, so a printout
 * or a publish batch covers exactly what the specs list showed.
 */
import * as React from "react"

import { useDeveloperMode } from "@/components/developer-mode-provider"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type {
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import {
  ALL_SELECTIONS,
  EMPTY_SELECTION_WORK_FILTER,
  selectionFilterActive,
  selectionFilterLabel,
  type SelectionWorkFilter,
} from "@/lib/selections/work-filter"

function countBy(values: readonly (string | null | undefined)[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) {
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

export function SelectionsFilterBar({
  summary,
  filteredSummary,
  options,
  filter,
  onFilterChange,
}: {
  readonly summary: ProjectSelectionsSummary
  readonly filteredSummary: ProjectSelectionsSummary
  readonly options: ProjectSelectionOptions
  readonly filter: SelectionWorkFilter
  readonly onFilterChange: (filter: SelectionWorkFilter) => void
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const selections = React.useMemo(() => summary.rooms.flatMap((room) => room.selections), [summary])
  const costCodeCounts = React.useMemo(() => countBy(selections.map((selection) => selection.costCode)), [selections])
  const divisionCounts = React.useMemo(() => {
    const divisionOf = new Map(options.costCodes.map((option) => [option.value, option.divisionCode]))
    return countBy(selections.map((selection) => (selection.costCode ? divisionOf.get(selection.costCode) : null)))
  }, [options.costCodes, selections])
  const codedCount = [...costCodeCounts.values()].reduce((total, count) => total + count, 0)
  const label = selectionFilterLabel(filter, options)

  function changeDivision(value: string): void {
    // A cost code outside the new division no longer applies.
    const keepCode =
      value === ALL_SELECTIONS ||
      options.costCodes.some((option) => option.value === filter.costCode && option.divisionCode === value)
    onFilterChange({ ...filter, division: value, costCode: keepCode ? filter.costCode : ALL_SELECTIONS })
  }

  return (
    <section className="border bg-background" aria-label="Filter selections">
      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))_auto]">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Find a selection</span>
          <Input
            type="search"
            value={filter.search}
            onChange={(event) => onFilterChange({ ...filter, search: event.target.value })}
            placeholder="Product, room, category..."
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Room</span>
          <SearchableCombobox
            value={filter.roomName}
            // An empty value is the picker's reset: show all rooms.
            onValueChange={(picked) => onFilterChange({ ...filter, roomName: picked || ALL_SELECTIONS })}
            options={[
              { value: ALL_SELECTIONS, label: "All rooms" },
              ...summary.rooms.map((room) => ({
                value: room.roomName,
                label: room.roomName,
                description: `${room.selections.length} selections`,
              })),
            ]}
            ariaLabel="Filter by room"
            placeholder="All rooms"
            searchPlaceholder="Search rooms..."
            emptyMessage="No matching rooms."
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Division</span>
          <SearchableCombobox
            value={filter.division}
            onValueChange={(picked) => changeDivision(picked || ALL_SELECTIONS)}
            options={[
              { value: ALL_SELECTIONS, label: "All divisions" },
              ...options.divisions
                .filter((option) => divisionCounts.has(option.value))
                .map((option) => ({
                  value: option.value,
                  label: option.label,
                  description: `${divisionCounts.get(option.value) ?? 0} selections`,
                  keywords: option.value,
                })),
            ]}
            ariaLabel="Filter by division"
            placeholder="All divisions"
            searchPlaceholder="Search divisions..."
            emptyMessage="No matching divisions."
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Cost code</span>
          <SearchableCombobox
            value={filter.costCode}
            onValueChange={(picked) => onFilterChange({ ...filter, costCode: picked || ALL_SELECTIONS })}
            options={[
              { value: ALL_SELECTIONS, label: "All cost codes" },
              ...options.costCodes
                .filter(
                  (option) =>
                    costCodeCounts.has(option.value) &&
                    (filter.division === ALL_SELECTIONS || option.divisionCode === filter.division)
                )
                .map((option) => ({
                  value: option.value,
                  label: option.label,
                  description: [
                    `${costCodeCounts.get(option.value) ?? 0} selections`,
                    developerModeEnabled && option.needsSageReview ? "needs Sage review" : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  keywords: option.value,
                })),
            ]}
            ariaLabel="Filter by cost code"
            placeholder="All cost codes"
            searchPlaceholder="Search cost codes..."
            emptyMessage="No matching cost codes."
          />
        </label>
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            className="w-full lg:w-auto"
            disabled={!selectionFilterActive(filter)}
            onClick={() => onFilterChange(EMPTY_SELECTION_WORK_FILTER)}
          >
            Clear
          </Button>
        </div>
      </div>
      <p className="border-t px-3 py-2 text-sm text-muted-foreground">
        Showing {filteredSummary.totalCount} of {summary.totalCount} selections in {filteredSummary.roomCount} room
        {filteredSummary.roomCount === 1 ? "" : "s"}
        {label ? ` for ${label}` : ""} · {codedCount} cost-coded
      </p>
    </section>
  )
}
