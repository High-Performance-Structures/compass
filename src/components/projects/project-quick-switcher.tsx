"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronsUpDown } from "lucide-react"

import type { ProjectListItem } from "@/app/actions/projects"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type ProjectQuickSwitcherProps = {
  readonly projects: readonly ProjectListItem[]
  readonly currentProjectId?: string | null
  readonly targetSection?: string
  readonly placeholder?: string
  readonly className?: string
}

function projectLabel(project: ProjectListItem): string {
  return project.projectNumber
    ? `${project.projectNumber} - ${project.name}`
    : project.name
}

function projectSearchValue(project: ProjectListItem): string {
  return [
    project.projectNumber,
    project.name,
    project.clientName,
    project.id,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
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
  const [open, setOpen] = React.useState(false)
  const selectedProject =
    projects.find((project) => project.id === currentProjectId) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Switch project"
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" ||
              event.key === " " ||
              event.key === "ArrowDown"
            ) {
              event.preventDefault()
              setOpen(true)
            }
          }}
          className={cn(
            "h-10 min-w-0 justify-between px-3 font-normal",
            className
          )}
          disabled={projects.length === 0}
        >
          <span
            className={cn(
              "truncate text-left",
              !selectedProject && "text-muted-foreground"
            )}
          >
            {selectedProject ? projectLabel(selectedProject) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder="Search number, name, or client..." />
          <CommandList>
            <CommandEmpty>No matching projects.</CommandEmpty>
            <CommandGroup>
              {projects.map((project) => {
                const isSelected = project.id === currentProjectId
                return (
                  <CommandItem
                    key={project.id}
                    value={projectSearchValue(project)}
                    onSelect={() => {
                      setOpen(false)
                      router.push(projectHref(project.id, targetSection))
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        isSelected ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {project.projectNumber ?? project.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {project.projectNumber ? project.name : project.clientName}
                        {project.projectNumber && project.clientName
                          ? ` - ${project.clientName}`
                          : ""}
                      </span>
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
