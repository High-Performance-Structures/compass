"use client"

import type { ProjectSelectionOptions, ProjectSelectionsSummary } from "@/lib/domain/selections/types"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

import { ALL, filtersWithDivision, selectionStatusLabel } from "./rfq-draft"
import type { RfqSelectionsState } from "./use-rfq-create-draft"

/** "Import finish selections": filter room selections and pull them in as rows. */
export function RfqSelectionImport({
  selections,
  selectionOptions,
  selectionsSummary,
}: {
  readonly selections: RfqSelectionsState
  readonly selectionOptions: ProjectSelectionOptions
  readonly selectionsSummary: ProjectSelectionsSummary
}): React.ReactElement {
  const {
    selectionFilters,
    setSelectionFilters,
    selectedSelectionIds,
    selectionDivisions,
    filteredSelectionCostCodes,
    filteredSelections,
    selectedSelections,
    toggleSelection,
    selectAllFilteredSelections,
    clearSelectedSelections,
    importSelectedSelections,
  } = selections
  return (
            <div className="border-y">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    Import finish selections
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Pull room selections into this RFQ scope by room, division,
                    or cost code.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={filteredSelections.length === 0}
                    onClick={selectAllFilteredSelections}
                  >
                    Select filtered
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={selectedSelectionIds.size === 0}
                    onClick={clearSelectedSelections}
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={selectedSelections.length === 0}
                    onClick={importSelectedSelections}
                  >
                    Import {selectedSelections.length || ""}
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Division
                  </span>
                  <SearchableCombobox
                    value={selectionFilters.division}
                    onValueChange={(picked) => {
                      // An empty value is the picker's reset: show all divisions.
                      const value = picked || ALL
                      setSelectionFilters((current) =>
                        filtersWithDivision(current, value, selectionOptions.costCodes)
                      )
                    }}
                    options={[
                      { value: ALL, label: "All divisions" },
                      ...selectionDivisions.map((option) => ({
                        value: option.value,
                        label: option.label,
                        keywords: option.value,
                      })),
                    ]}
                    ariaLabel="Filter selections by division"
                    placeholder="All divisions"
                    searchPlaceholder="Search divisions..."
                    emptyMessage="No matching divisions."
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Cost code
                  </span>
                  <SearchableCombobox
                    value={selectionFilters.costCode}
                    onValueChange={(picked) =>
                      setSelectionFilters((current) => ({
                        ...current,
                        costCode: picked || ALL,
                      }))
                    }
                    options={[
                      { value: ALL, label: "All cost codes" },
                      ...filteredSelectionCostCodes.map((option) => ({
                        value: option.value,
                        label: option.label,
                        description: option.needsSageReview ? "Needs review" : undefined,
                        keywords: option.value,
                      })),
                    ]}
                    ariaLabel="Filter selections by cost code"
                    placeholder="All cost codes"
                    searchPlaceholder="Search cost codes..."
                    emptyMessage="No matching cost codes."
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Room
                  </span>
                  <SearchableCombobox
                    value={selectionFilters.roomName}
                    onValueChange={(picked) =>
                      setSelectionFilters((current) => ({
                        ...current,
                        roomName: picked || ALL,
                      }))
                    }
                    options={[
                      { value: ALL, label: "All rooms" },
                      ...selectionsSummary.rooms.map((room) => ({
                        value: room.roomName,
                        label: room.roomName,
                        description: `${room.selections.length} selections`,
                      })),
                    ]}
                    ariaLabel="Filter selections by room"
                    placeholder="All rooms"
                    searchPlaceholder="Search rooms..."
                    emptyMessage="No matching rooms."
                  />
                </label>
              </div>
              <div className="max-h-72 overflow-y-auto border-t">
                {filteredSelections.length > 0 ? (
                  filteredSelections.map((selection) => (
                    <label
                      key={selection.id}
                      className="grid cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_7rem_8rem] gap-2 border-b px-2 py-2 text-sm last:border-b-0 hover:bg-accent/60"
                    >
                      <Checkbox
                        checked={selectedSelectionIds.has(selection.id)}
                        onCheckedChange={(checked) =>
                          toggleSelection(selection.id, checked === true)
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {selection.roomName}: {selection.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[
                            selection.category,
                            selection.manufacturer,
                            selection.model,
                          ]
                            .filter((value): value is string => Boolean(value))
                            .join(" · ") || "Selection detail"}
                        </span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {selection.costCode ?? "No code"}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {selectionStatusLabel(selection.status)}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="px-2 py-4 text-sm text-muted-foreground">
                    No finish selections match these filters.
                  </p>
                )}
              </div>
            </div>
  )
}
