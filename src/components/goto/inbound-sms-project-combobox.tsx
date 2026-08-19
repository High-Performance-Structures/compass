"use client"

import * as React from "react"
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

type ProjectOption = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
}

function projectLabel(project: ProjectOption): string {
  return project.projectNumber
    ? `${project.projectNumber} — ${project.name}`
    : project.name
}

function isPrintableKey(event: React.KeyboardEvent<HTMLButtonElement>): boolean {
  return (
    event.key.length === 1 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  )
}

export function InboundSmsProjectCombobox({
  id,
  projects,
  defaultValue,
}: {
  readonly id: string
  readonly projects: readonly ProjectOption[]
  readonly defaultValue: string | null
}): React.ReactElement {
  const initialValue =
    defaultValue && projects.some((project) => project.id === defaultValue)
      ? defaultValue
      : ""
  const [open, setOpen] = React.useState(false)
  const [searchValue, setSearchValue] = React.useState("")
  const [selectedProjectId, setSelectedProjectId] =
    React.useState(initialValue)
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null

  function updateOpen(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (!nextOpen) setSearchValue("")
  }

  return (
    <Popover open={open} onOpenChange={updateOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-required="true"
          className="h-10 w-full min-w-0 justify-between px-3 font-normal"
          disabled={projects.length === 0}
          onKeyDown={(event) => {
            if (!isPrintableKey(event)) return
            event.preventDefault()
            setSearchValue(event.key)
            setOpen(true)
          }}
        >
          <span
            className={cn(
              "truncate text-left",
              !selectedProject && "text-muted-foreground"
            )}
          >
            {selectedProject ? projectLabel(selectedProject) : "Select project…"}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] max-w-[min(92vw,640px)] p-0"
      >
        <Command>
          <CommandInput
            autoFocus
            value={searchValue}
            onValueChange={setSearchValue}
            placeholder="Type a project number or name…"
          />
          <CommandList className="compass-content-scroll max-h-80">
            <CommandEmpty>No matching projects.</CommandEmpty>
            <CommandGroup>
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`${project.projectNumber ?? ""} ${project.name} ${project.id}`}
                  onSelect={() => {
                    setSelectedProjectId(project.id)
                    updateOpen(false)
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
      <input
        name="projectId"
        value={selectedProjectId}
        required
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={() => undefined}
        onInvalid={(event) => {
          event.preventDefault()
          setOpen(true)
        }}
      />
    </Popover>
  )
}
