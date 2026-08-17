"use client"

import * as React from "react"
import { useFormStatus } from "react-dom"
import { Check, ChevronsUpDown } from "lucide-react"

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

export type SearchableProjectFormOption = Readonly<{
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
}>

function projectLabel(project: SearchableProjectFormOption): string {
  return project.projectNumber
    ? `${project.projectNumber} — ${project.name}`
    : project.name
}

function projectSearchValue(project: SearchableProjectFormOption): string {
  return [project.projectNumber, project.name, project.id]
    .filter((value): value is string => Boolean(value))
    .join(" ")
}

export function SearchableProjectFormSelect({
  projects,
  name = "projectId",
  placeholder = "Select project…",
}: {
  readonly projects: readonly SearchableProjectFormOption[]
  readonly name?: string
  readonly placeholder?: string
}): React.ReactElement {
  const { pending } = useFormStatus()
  const [open, setOpen] = React.useState(false)
  const [selectedProjectId, setSelectedProjectId] = React.useState("")
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null

  return (
    <>
      <input type="hidden" name={name} value={selectedProjectId} readOnly />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-required="true"
            disabled={pending || projects.length === 0}
            className="h-10 w-full justify-between bg-background px-3 font-normal"
          >
            <span
              className={cn(
                "min-w-0 truncate text-left",
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
            <CommandInput placeholder="Search project number or name…" />
            <CommandList className="compass-content-scroll max-h-72">
              <CommandEmpty>No matching projects.</CommandEmpty>
              <CommandGroup>
                {projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={projectSearchValue(project)}
                    onSelect={() => {
                      setSelectedProjectId(project.id)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        selectedProjectId === project.id
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {project.projectNumber ?? project.name}
                      </span>
                      {project.projectNumber ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {project.name}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  )
}
