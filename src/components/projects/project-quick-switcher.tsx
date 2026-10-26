"use client"

import type * as React from "react"
import { useRouter } from "next/navigation"

import type { ProjectListItem } from "@/app/actions/projects"
import { projectBrowseIds } from "@/lib/project-views"
import { useActiveProject, useProjectViewPreferences } from "@/components/project-list-provider"
import { ProjectCombobox } from "@/components/projects/project-combobox"

type ProjectQuickSwitcherProps = {
  readonly projects: readonly ProjectListItem[]
  readonly applyDefaultView?: boolean
  readonly currentProjectId?: string | null
  readonly targetSection?: string
  readonly placeholder?: string
  readonly placeholderClassName?: string
  readonly className?: string
}

function projectHref(projectId: string, targetSection?: string): string {
  const baseHref = `/dashboard/projects/${projectId}`
  return targetSection ? `${baseHref}/${targetSection}` : baseHref
}

export function ProjectQuickSwitcher({
  projects,
  applyDefaultView = false,
  currentProjectId = null,
  targetSection,
  placeholder = "Search projects...",
  placeholderClassName,
  className,
}: ProjectQuickSwitcherProps): React.ReactElement {
  const router = useRouter()
  const { setActiveProjectId } = useActiveProject()
  const { defaultDefinition } = useProjectViewPreferences()
  const browseValues = !applyDefaultView || defaultDefinition === null ? undefined : projectBrowseIds(projects, defaultDefinition, currentProjectId)

  return (
    <ProjectCombobox
      projects={projects}
      browseValues={browseValues}
      browseHeading={browseValues === undefined ? undefined : `Showing ${browseValues.length} of ${projects.length} · your default view`}
      searchHint="Type to search all statuses and departments."
      emptyMessage="No matching projects. Search includes all statuses and departments."
      value={currentProjectId ?? ""}
      onValueChange={(projectId) => {
        setActiveProjectId(projectId)
        router.push(projectHref(projectId, targetSection))
      }}
      ariaLabel="Switch project"
      placeholder={placeholder}
      placeholderClassName={placeholderClassName}
      className={className}
    />
  )
}
