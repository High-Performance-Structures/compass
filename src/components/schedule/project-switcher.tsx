"use client"

import { useRouter } from "next/navigation"
import { IconBuilding } from "@tabler/icons-react"

import { ProjectCombobox } from "@/components/projects/project-combobox"

interface ProjectSwitcherProps {
  readonly projects: readonly {
    readonly id: string
    readonly name: string
    readonly projectNumber?: string | null
  }[]
  readonly currentProjectId: string
  readonly currentProjectName: string
}

export function ProjectSwitcher({
  projects,
  currentProjectId,
  currentProjectName,
}: ProjectSwitcherProps) {
  const router = useRouter()

  const handleProjectChange = (projectId: string) => {
    if (projectId !== currentProjectId) {
      router.push(`/dashboard/projects/${projectId}/schedule`)
    }
  }

  if (projects.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <IconBuilding className="size-4 text-muted-foreground" />
        <span className="text-lg font-semibold truncate">{currentProjectName}</span>
      </div>
    )
  }

  return (
    <ProjectCombobox
      projects={projects}
      value={currentProjectId}
      onValueChange={handleProjectChange}
      ariaLabel="Switch project"
      className="h-9 w-auto max-w-[280px] gap-2 font-medium"
      popoverClassName="w-[min(24rem,calc(100vw-3rem))]"
    />
  )
}
