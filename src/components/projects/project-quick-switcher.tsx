"use client"

import type * as React from "react"
import { useRouter } from "next/navigation"

import type { ProjectListItem } from "@/app/actions/projects"
import { useActiveProject } from "@/components/project-list-provider"
import { ProjectCombobox } from "@/components/projects/project-combobox"

type ProjectQuickSwitcherProps = {
  readonly projects: readonly ProjectListItem[]
  readonly currentProjectId?: string | null
  readonly targetSection?: string
  readonly placeholder?: string
  readonly className?: string
}

function projectHref(projectId: string, targetSection?: string): string {
  const baseHref = `/dashboard/projects/${projectId}`
  return targetSection ? `${baseHref}/${targetSection}` : baseHref
}

export function ProjectQuickSwitcher({
  projects,
  currentProjectId = null,
  targetSection,
  placeholder = "Search projects...",
  className,
}: ProjectQuickSwitcherProps): React.ReactElement {
  const router = useRouter()
  const { setActiveProjectId } = useActiveProject()

  return (
    <ProjectCombobox
      projects={projects}
      value={currentProjectId ?? ""}
      onValueChange={(projectId) => {
        setActiveProjectId(projectId)
        router.push(projectHref(projectId, targetSection))
      }}
      ariaLabel="Switch project"
      placeholder={placeholder}
      className={className}
    />
  )
}
