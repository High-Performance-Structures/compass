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
  scheduleScopeLabel,
  type ScheduleProjectData,
  type ScheduleScope,
} from "@/lib/schedule/project-scope"
import { projectDepartment } from "@/lib/project-branding"

type ScheduleScopeSwitcherProps = {
  readonly projects: readonly ProjectListItem[]
  readonly scheduleProjects: readonly ScheduleProjectData[]
  readonly scope: ScheduleScope
}

function scopeHref(
  searchParams: URLSearchParams,
  next:
    | { readonly scope: "all" }
    | { readonly scope: "department"; readonly department: string }
    | { readonly scope: "selected"; readonly projectIds: readonly string[] }
    | { readonly scope: "project"; readonly projectId: string }
): string {
  const params = new URLSearchParams(searchParams.toString())
  params.set("mode", "projects")
  params.set("scope", next.scope)
  params.delete("department")
  params.delete("project")
  params.delete("projects")

  if (next.scope === "department") {
    params.set("department", next.department)
  } else if (next.scope === "selected") {
    params.set("projects", next.projectIds.join(","))
  } else if (next.scope === "project") {
    params.set("project", next.projectId)
  }

  return `/dashboard/schedule?${params.toString()}`
}

export function ScheduleScopeSwitcher({
  projects,
  scheduleProjects,
  scope,
}: ScheduleScopeSwitcherProps): React.ReactElement {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = React.useState(false)
  const selectedIds = new Set(
    scope.kind === "project" || scope.kind === "selected"
      ? scope.projectIds
      : []
  )

  function navigate(href: string): void {
    setOpen(false)
    router.push(href)
  }

  function toggleProject(projectId: string): void {
    const customProjectIds =
      scope.kind === "project" || scope.kind === "selected"
        ? scope.projectIds
        : []
    const nextIds = selectedIds.has(projectId)
      ? customProjectIds.filter((id) => id !== projectId)
      : [...customProjectIds, projectId]
    if (nextIds.length === 0) return
    if (nextIds.length === 1) {
      navigate(
        scopeHref(searchParams, {
          scope: "project",
          projectId: nextIds[0],
        })
      )
      return
    }
    navigate(
      scopeHref(searchParams, {
        scope: "selected",
        projectIds: nextIds,
      })
    )
  }

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
        <div className="grid grid-cols-5 gap-1 p-2">
          <Button
            type="button"
            size="sm"
            variant={scope.kind === "all" ? "default" : "ghost"}
            className="col-span-1"
            onClick={() =>
              navigate(scopeHref(searchParams, { scope: "all" }))
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
                  scopeHref(searchParams, {
                    scope: "department",
                    department,
                  })
                )
              }
            >
              {department}
            </Button>
          ))}
        </div>
        <Separator />
        <Command>
          <CommandInput placeholder="Search projects to select..." />
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
