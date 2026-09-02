"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Check, ChevronsUpDown, Layers3 } from "lucide-react"

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
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  projectScheduleLabel,
  scheduleProjectSelection,
  scheduleScopeHref,
  scheduleSelectionModeFor,
  scheduleScopeLabel,
  type ScheduleProjectData,
  type ScheduleSelectionMode,
  type ScheduleScope,
} from "@/lib/schedule/project-scope"
import { projectDepartment } from "@/lib/project-branding"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

type ScheduleScopeSwitcherProps = {
  readonly projects: readonly ProjectListItem[]
  readonly scheduleProjects: readonly ScheduleProjectData[]
  readonly scope: ScheduleScope
}

export function ScheduleScopeSwitcher({
  projects,
  scheduleProjects,
  scope,
}: ScheduleScopeSwitcherProps): React.ReactElement {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = React.useState(false)
  const selectionMode = scheduleSelectionModeFor(
    searchParams.get("selection"),
    scope.kind
  )
  const selectedIds = new Set(
    scope.kind === "project" || scope.kind === "selected"
      ? scope.projectIds
      : []
  )

  function navigate(href: string, close = true): void {
    if (close) setOpen(false)
    router.push(href)
  }

  function scopeLinkForMode(mode: ScheduleSelectionMode): string {
    if (scope.kind === "project" || scope.kind === "selected") {
      const projectIds = [...selectedIds]
      return scheduleScopeHref(
        searchParams,
        mode === "single"
          ? projectIds[0]
            ? { scope: "project", projectId: projectIds[0] }
            : { scope: "selected", projectIds: [] }
          : { scope: "selected", projectIds },
        mode
      )
    }
    return scheduleScopeHref(
      searchParams,
      scope.kind === "department"
        ? { scope: "department", department: scope.department }
        : { scope: "all" },
      mode
    )
  }

  function changeSelectionMode(value: string): void {
    if (value !== "single" && value !== "multiple") return
    navigate(scopeLinkForMode(value), false)
  }

  function toggleProject(projectId: string): void {
    const currentIds = [...selectedIds]
    const nextIds = scheduleProjectSelection(
      selectionMode,
      currentIds,
      projectId
    )
    navigate(
      scheduleScopeHref(
        searchParams,
        selectionMode === "single"
          ? { scope: "project", projectId }
          : { scope: "selected", projectIds: nextIds },
        selectionMode
      ),
      selectionMode === "single"
    )
  }

  const selectedProjectLabels = projects
    .filter((project) => selectedIds.has(project.id))
    .map((project) => ({
      id: project.id,
      label: projectScheduleLabel(project),
    }))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Choose schedule scope"
          className="h-8 min-w-[220px] max-w-full justify-between px-3 font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Layers3 className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {scheduleScopeLabel(scope, scheduleProjects)}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] max-w-[90vw] p-0">
        <div className="space-y-3 p-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium" id="schedule-selection-mode-label">
              Project selection
            </p>
            <ToggleGroup
              type="single"
              value={selectionMode}
              onValueChange={changeSelectionMode}
              aria-labelledby="schedule-selection-mode-label"
              className="grid w-full grid-cols-2"
              size="sm"
              variant="outline"
            >
              <ToggleGroupItem value="single">Single schedule</ToggleGroupItem>
              <ToggleGroupItem value="multiple">Multiple schedules</ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground" id="schedule-selection-mode-help">
              {selectionMode === "single"
                ? "Choose one project. A new choice replaces the current project."
                : "Check projects to compare their schedules. You can select none or several."}
            </p>
          </div>
          {selectionMode === "multiple" && (
            <div
              aria-live="polite"
              className="rounded-md border bg-muted/30 px-2.5 py-2 text-xs"
            >
              <p className="font-medium">
                {selectedProjectLabels.length === 0
                  ? "No projects selected"
                  : `${selectedProjectLabels.length} selected`}
              </p>
              {selectedProjectLabels.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {selectedProjectLabels.map((project) => (
                    <li key={project.id}>{project.label}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <Separator />
        <div className="grid grid-cols-5 gap-1 p-2">
          <Button
            type="button"
            size="sm"
            variant={scope.kind === "all" ? "default" : "ghost"}
            className="col-span-1"
            onClick={() =>
              navigate(
                scheduleScopeHref(searchParams, { scope: "all" }, selectionMode)
              )
            }
          >
            All
          </Button>
          {(["O", "H", "N", "D"] as const).map((department) => (
            <Button
              key={department}
              type="button"
              size="sm"
              variant={
                scope.kind === "department" &&
                scope.department === department
                  ? "default"
                  : "ghost"
              }
              onClick={() =>
                navigate(
                  scheduleScopeHref(
                    searchParams,
                    { scope: "department", department },
                    selectionMode
                  )
                )
              }
            >
              {department}
            </Button>
          ))}
        </div>
        <Separator />
        <Command>
          <CommandInput
            placeholder="Search projects..."
            aria-describedby="schedule-selection-mode-help"
          />
          <CommandList className="max-h-72">
            <CommandEmpty>No matching projects.</CommandEmpty>
            <CommandGroup heading="Projects">
              {projects.map((project) => {
                const department = projectDepartment({
                  projectId: project.id,
                  projectNumber: project.projectNumber,
                })
                const selected = selectedIds.has(project.id)
                return (
                  <CommandItem
                    key={project.id}
                    className={cn(
                      selected && "bg-accent/50 font-medium"
                    )}
                    data-schedule-selected={selected}
                    value={[
                      project.projectNumber,
                      project.name,
                      project.clientName,
                      department,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onSelect={() => toggleProject(project.id)}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        selected ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {projectScheduleLabel({
                        name: project.name,
                        projectNumber: project.projectNumber,
                      })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {department}
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
