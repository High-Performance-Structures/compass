"use client"

import type * as React from "react"
import { useMemo } from "react"
import { useRouter } from "next/navigation"

import type { ProjectListItem } from "@/app/actions/projects"
import { projectBrowseIds, projectMatchesView } from "@/lib/project-views"
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
  const browseValues = useMemo(() => !applyDefaultView || defaultDefinition === null ? undefined : projectBrowseIds(projects, defaultDefinition, currentProjectId), [applyDefaultView, projects, defaultDefinition, currentProjectId])
  const matchCount = useMemo(() => defaultDefinition === null ? projects.length : projects.filter((project) => projectMatchesView(project, defaultDefinition)).length, [projects, defaultDefinition])

  return (
    <ProjectCombobox
      projects={projects}
      browseValues={browseValues}
      browseHeading={browseValues === undefined ? undefined : `Showing ${matchCount} of ${projects.length} · your default view`}
      searchHint={browseValues === undefined ? undefined : "Type to search all statuses and departments."}
      emptyMessage={browseValues === undefined ? undefined : "No matching projects. Search includes all statuses and departments."}
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
