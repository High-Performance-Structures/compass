"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronsUpDown, MessageCircle } from "lucide-react"

import { openProjectConversationChannel } from "@/app/actions/project-messages"
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

function projectLabel(project: ProjectListItem): string {
  return project.projectNumber
    ? `${project.projectNumber} - ${project.name}`
    : project.name
}

function projectSearchValue(project: ProjectListItem): string {
  return [project.projectNumber, project.name, project.clientName, project.id]
    .filter((value): value is string => Boolean(value))
    .join(" ")
}

export function ProjectConversationLauncher({
  projects,
}: {
  readonly projects: readonly ProjectListItem[]
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(
    null
  )
  const [isPending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null

  function openConversation(projectId: string): void {
    setError(null)
    setSelectedProjectId(projectId)
    startTransition(async () => {
      const result = await openProjectConversationChannel(projectId)
      if (!result.success) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.push(`/dashboard/conversations/${result.data.channelId}`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between bg-background font-normal"
            disabled={projects.length === 0 || isPending}
          >
            <span className="truncate">
              {selectedProject
                ? projectLabel(selectedProject)
                : "Open a project conversation"}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(520px,calc(100vw-2rem))] p-0">
          <Command>
            <CommandInput placeholder="Search project number, name, or client..." />
            <CommandList className="max-h-80 overflow-y-auto">
              <CommandEmpty>No matching projects.</CommandEmpty>
              <CommandGroup>
                {projects.map((project) => {
                  const isSelected = project.id === selectedProjectId
                  return (
                    <CommandItem
                      key={project.id}
                      value={projectSearchValue(project)}
                      onSelect={() => openConversation(project.id)}
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
                      <MessageCircle className="size-4 text-muted-foreground" />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {isPending && (
        <p className="text-xs text-muted-foreground">Opening conversation...</p>
      )}
    </div>
  )
}
