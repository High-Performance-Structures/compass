"use client"

import * as React from "react"

import { useProjectList } from "@/components/project-list-provider"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"

export function ProjectContextSwitcher({
  currentProjectId,
  targetSection,
  placeholder = "Switch project...",
  className,
}: {
  readonly currentProjectId: string
  readonly targetSection?: string
  readonly placeholder?: string
  readonly className?: string
}): React.ReactElement | null {
  const projects = useProjectList()

  if (projects.length < 2) return null

  return (
    <ProjectQuickSwitcher
      projects={projects}
      currentProjectId={currentProjectId}
      targetSection={targetSection}
      placeholder={placeholder}
      className={className}
    />
  )
}
