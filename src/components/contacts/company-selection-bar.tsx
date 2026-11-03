"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { SearchableCombobox } from "@/components/searchable-combobox"
import type { AssociationProjectOption } from "@/components/contacts/contacts-bootstrap"
import { projectNumberAndName } from "@/lib/project-display-name"

/** Bulk actions for the selected companies: add to a project, or merge two duplicates. */
export function CompanySelectionBar({
  noun,
  selectedCount,
  projects,
  projectId,
  onProjectChange,
  onAssociate,
  canMerge,
  onMerge,
  onClear,
}: {
  readonly noun: string
  readonly selectedCount: number
  readonly projects: readonly AssociationProjectOption[]
  readonly projectId: string
  readonly onProjectChange: (projectId: string) => void
  readonly onAssociate: () => void
  readonly canMerge: boolean
  readonly onMerge: () => void
  readonly onClear: () => void
}): React.ReactElement {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-b pb-2 text-sm">
      <span className="text-muted-foreground">{selectedCount} {noun} selected</span>
      {projects.length > 0 ? (
        <>
          <SearchableCombobox
            ariaLabel="Choose project for selected companies"
            options={projects.map((project) => ({
              value: project.id,
              label: project.projectNumber ? projectNumberAndName(project, " · ") : project.name,
            }))}
            value={projectId}
            onValueChange={onProjectChange}
            placeholder="Choose project..."
            searchPlaceholder="Search projects..."
            className="w-72"
          />
          <Button type="button" size="sm" disabled={selectedCount === 0 || selectedCount > 100 || !projectId} onClick={onAssociate}>
            Add selected to project
          </Button>
        </>
      ) : null}
      {canMerge ? (
        <Button type="button" size="sm" variant="outline" disabled={selectedCount !== 2} onClick={onMerge}>
          Merge 2 duplicates
        </Button>
      ) : null}
      {selectedCount > 0 ? <Button type="button" size="sm" variant="ghost" onClick={onClear}>Clear selection</Button> : null}
      <span className="text-xs text-muted-foreground">
        {selectedCount > 100 ? "Choose at most 100 records per batch. " : ""}
        {canMerge ? "Tip: use Merge with… in a row's menu to search for its duplicate. " : ""}
        Project association and duplicate merging never grant Compass access.
      </span>
    </div>
  )
}
