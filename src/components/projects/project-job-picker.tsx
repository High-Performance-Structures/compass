"use client"

import * as React from "react"

import { useProjectList } from "@/components/project-list-provider"
import { SearchableCombobox } from "@/components/searchable-combobox"

/**
 * Search-as-you-type picker over the jobs this person can open, matched by
 * number, name or client. The value is the project id.
 */
export function ProjectJobPicker({
  value,
  onValueChange,
  excludeIds,
  id,
  ariaLabel = "Choose a job",
  disabled = false,
}: {
  readonly value: string
  readonly onValueChange: (projectId: string) => void
  readonly excludeIds?: readonly string[]
  readonly id?: string
  readonly ariaLabel?: string
  readonly disabled?: boolean
}): React.ReactElement {
  const projects = useProjectList()
  const options = React.useMemo(() => {
    const excluded = new Set(excludeIds ?? [])
    return projects
      .filter((project) => !excluded.has(project.id))
      .map((project) => ({
        value: project.id,
        label: project.projectNumber ? `${project.projectNumber} · ${project.name}` : project.name,
        description: [project.clientName, project.jobStatusLabel].filter(Boolean).join(" · ") || undefined,
        keywords: project.clientName ?? undefined,
      }))
  }, [projects, excludeIds])

  return (
    <SearchableCombobox
      id={id}
      options={options}
      value={value}
      onValueChange={onValueChange}
      ariaLabel={ariaLabel}
      placeholder="Choose a job"
      searchPlaceholder="Search by number, name or client..."
      emptyMessage="No matching jobs."
      disabled={disabled}
    />
  )
}
