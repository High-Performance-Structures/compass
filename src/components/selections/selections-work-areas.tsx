"use client"

/*
 * A job's Selections page below the header: the "Work on" picker (`?work=`)
 * and its four areas, Selection sheet (default), Publish to owner, Finish
 * specs and Print & share. Every area stays mounted and only the chosen one
 * shows, as on the Estimate page. Publish, specs and print share one filter
 * bar, so each lists the same selections.
 */
import * as React from "react"

import { ProjectSelectionShareActions } from "@/components/projects/project-selection-share-actions"
import { ProjectSelectionsWorkspace } from "@/components/projects/project-selections-workspace"
import { SelectionPublishRooms } from "@/components/selections/selection-publish-rooms"
import { SelectionsFilterBar } from "@/components/selections/selections-filter-bar"
import { useWorkOnArea, WorkOnPicker } from "@/components/work-on-picker"
import type { SelectionLeadTimeWarning } from "@/lib/domain/selections/lead-time-rules"
import type {
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import type { ProjectBrand } from "@/lib/project-branding"
import type { SelectionWorkspace } from "@/lib/selections/types"
import { SELECTION_WORK_AREAS, type SelectionWorkArea } from "@/lib/selections/work-areas"
import {
  costCodeDivisions,
  EMPTY_SELECTION_WORK_FILTER,
  filterDecisionItems,
  filterSelectionsSummary,
  selectionFilterLabel,
} from "@/lib/selections/work-filter"

export function SelectionsWorkAreas({
  initialArea,
  sheet,
  workspace,
  summary,
  options,
  leadTimeWarnings,
  brand,
  clientName,
  projectId,
  projectLabel,
}: {
  readonly initialArea: SelectionWorkArea
  /** The Selection sheet, rendered by the page. */
  readonly sheet: React.ReactNode
  readonly workspace: SelectionWorkspace
  readonly summary: ProjectSelectionsSummary
  readonly options: ProjectSelectionOptions
  readonly leadTimeWarnings: readonly SelectionLeadTimeWarning[]
  readonly brand: ProjectBrand
  readonly clientName: string | null
  readonly projectId: string
  readonly projectLabel: string
}): React.ReactElement {
  const [area, setArea] = useWorkOnArea(SELECTION_WORK_AREAS, initialArea)
  const [filter, setFilter] = React.useState(EMPTY_SELECTION_WORK_FILTER)
  const divisions = React.useMemo(() => costCodeDivisions(options), [options])
  const filteredSummary = React.useMemo(
    () => filterSelectionsSummary(summary, filter, divisions),
    [divisions, filter, summary]
  )
  const decisionItems = React.useMemo(
    () => filterDecisionItems(workspace.items, filteredSummary, filter),
    [filter, filteredSummary, workspace.items]
  )

  return (
    <div className="space-y-4">
      <WorkOnPicker
        id="selections-work-area"
        areas={SELECTION_WORK_AREAS}
        value={area}
        onValueChange={setArea}
        searchPlaceholder="Search selection areas..."
      />

      <div hidden={area !== "sheet"}>{sheet}</div>

      {area !== "sheet" && summary.rooms.length > 0 && (
        <SelectionsFilterBar
          summary={summary}
          filteredSummary={filteredSummary}
          options={options}
          filter={filter}
          onFilterChange={setFilter}
        />
      )}

      <div hidden={area !== "publish"}>
        <SelectionPublishRooms
          workspace={workspace}
          items={decisionItems}
          leadTimeWarnings={leadTimeWarnings}
        />
      </div>

      <div hidden={area !== "specs"}>
        <ProjectSelectionsWorkspace
          options={options}
          projectId={projectId}
          summary={summary}
          filteredSummary={filteredSummary}
          onClearFilters={() => setFilter(EMPTY_SELECTION_WORK_FILTER)}
          leadTimeWarnings={leadTimeWarnings}
        />
      </div>

      <div hidden={area !== "share"}>
        <ProjectSelectionShareActions
          brand={brand}
          clientName={clientName}
          filterLabel={selectionFilterLabel(filter, options)}
          projectId={projectId}
          projectLabel={projectLabel}
          summary={filteredSummary}
        />
      </div>
    </div>
  )
}
