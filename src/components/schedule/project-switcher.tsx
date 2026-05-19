"use client"

import { useRouter } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { IconChevronDown, IconBuilding } from "@tabler/icons-react"

interface ProjectSwitcherProps {
  projects: { id: string; name: string; projectNumber?: string | null }[]
  currentProjectId: string
  currentProjectName: string
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
    <Select value={currentProjectId} onValueChange={handleProjectChange}>
      <SelectTrigger className="h-9 w-auto border border-input bg-background hover:bg-accent hover:text-accent-foreground gap-2 px-3 max-w-[280px]">
        <IconBuilding className="size-4 text-muted-foreground shrink-0" />
        <span className="truncate font-medium">{currentProjectName}</span>
        <IconChevronDown className="size-4 text-muted-foreground shrink-0 ml-auto" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.projectNumber ?? project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
