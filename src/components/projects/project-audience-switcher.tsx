"use client"

import type * as React from "react"
import { useRouter } from "next/navigation"

import type { AudienceProjectOption } from "@/app/actions/project-audience-preview"
import { ProjectCombobox } from "@/components/projects/project-combobox"
import {
  projectAudienceSectionHref,
  type ProjectAudiencePreviewRoute,
  type ProjectAudienceWorkspaceSection,
} from "@/lib/project-audience-preview-routes"

export function ProjectAudienceSwitcher({
  projects,
  currentProjectId,
  audience,
  section,
  className,
}: {
  readonly projects: readonly AudienceProjectOption[]
  readonly currentProjectId: string
  readonly audience: ProjectAudiencePreviewRoute
  readonly section: ProjectAudienceWorkspaceSection
  readonly className?: string
}): React.ReactElement {
  const router = useRouter()

  return (
    <ProjectCombobox
      projects={projects}
      value={currentProjectId}
      onValueChange={(projectId) => {
        if (projectId === currentProjectId) return
        router.push(projectAudienceSectionHref(projectId, audience, section))
      }}
      ariaLabel="Switch preview project"
      className={className}
      popoverClassName="w-[min(22rem,calc(100vw-3rem))]"
    />
  )
}
