"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import type { AudienceProjectOption } from "@/app/actions/project-audience-preview"
import { ProjectCombobox } from "@/components/projects/project-combobox"
import { projectAudienceActiveProjectCookieName } from "@/lib/project-audience-active-project"
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
  const rememberProject = React.useCallback(
    (projectId: string): void => {
      const cookieName = projectAudienceActiveProjectCookieName(audience)
      document.cookie = `${cookieName}=${encodeURIComponent(projectId)}; Path=/; Max-Age=31536000; SameSite=Lax`
    },
    [audience]
  )

  React.useEffect(() => {
    rememberProject(currentProjectId)
  }, [currentProjectId, rememberProject])

  return (
    <ProjectCombobox
      projects={projects}
      value={currentProjectId}
      onValueChange={(projectId) => {
        if (projectId === currentProjectId) return
        rememberProject(projectId)
        router.push(projectAudienceSectionHref(projectId, audience, section))
      }}
      ariaLabel="Switch project"
      className={className}
      popoverClassName="w-[min(22rem,calc(100vw-3rem))]"
    />
  )
}
