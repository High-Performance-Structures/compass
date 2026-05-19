"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  IconAddressBook,
  IconBrandGoogleDrive,
  IconBuildingCommunity,
  IconCalendarStats,
  IconCompass,
  IconFileDollar,
  IconFolder,
  IconHome,
  IconPaint,
  IconPlus,
  IconSearch,
  IconSettingsAutomation,
  IconTool,
} from "@tabler/icons-react"

import type { ProjectsHubProject } from "@/app/dashboard/projects/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type DepartmentId = "O" | "H" | "N" | "D" | "UNASSIGNED"
type ProjectStatusBucket = "active" | "warranty" | "complete" | "other"

type DepartmentConfig = {
  readonly id: DepartmentId
  readonly label: string
  readonly shortLabel: string
  readonly description: string
  readonly accentClassName: string
  readonly icon: React.ReactNode
}

type DepartmentGroup = DepartmentConfig & {
  readonly projects: readonly ProjectsHubProject[]
}

type StatusFilterConfig = {
  readonly id: ProjectStatusBucket
  readonly label: string
  readonly description: string
}

const DEPARTMENTS: readonly DepartmentConfig[] = [
  {
    id: "O",
    label: "ORC Projects",
    shortLabel: "ORC",
    description: "Open Range Construction jobs and owner-facing builds.",
    accentClassName: "border-emerald-700/35 bg-emerald-700/10 text-emerald-900",
    icon: <IconHome className="size-4" />,
  },
  {
    id: "H",
    label: "HPS Projects",
    shortLabel: "HPS",
    description: "High Performance Structures work and internal construction.",
    accentClassName: "border-sky-700/30 bg-sky-700/10 text-sky-900",
    icon: <IconBuildingCommunity className="size-4" />,
  },
  {
    id: "N",
    label: "Nu-Tech Projects",
    shortLabel: "Nu-Tech",
    description: "ICF sales, bracing rental, support, and related projects.",
    accentClassName: "border-amber-700/30 bg-amber-700/10 text-amber-900",
    icon: <IconTool className="size-4" />,
  },
  {
    id: "D",
    label: "Design Projects",
    shortLabel: "Design",
    description: "Design-only scopes, drafting, estimating, and handoff work.",
    accentClassName: "border-violet-700/30 bg-violet-700/10 text-violet-900",
    icon: <IconPaint className="size-4" />,
  },
  {
    id: "UNASSIGNED",
    label: "Unassigned",
    shortLabel: "Other",
    description: "Projects that still need an O, H, N, or D project number.",
    accentClassName: "border-muted-foreground/25 bg-muted text-muted-foreground",
    icon: <IconFolder className="size-4" />,
  },
]

const STATUS_FILTERS: readonly StatusFilterConfig[] = [
  {
    id: "active",
    label: "Active",
    description: "Current work and jobs that should be visible day to day.",
  },
  {
    id: "warranty",
    label: "Warranty",
    description: "Completed jobs still carrying warranty or service attention.",
  },
  {
    id: "complete",
    label: "Complete",
    description: "Closed, archived, or historical projects.",
  },
  {
    id: "other",
    label: "Other",
    description: "Imported statuses that need cleanup or mapping.",
  },
]

function normalizeSearchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function departmentIdForProject(project: ProjectsHubProject): DepartmentId {
  const firstCharacter = project.projectNumber?.trim().slice(0, 1).toUpperCase()
  if (firstCharacter === "O") return "O"
  if (firstCharacter === "H") return "H"
  if (firstCharacter === "N") return "N"
  if (firstCharacter === "D") return "D"
  return "UNASSIGNED"
}

function projectLabel(project: ProjectsHubProject): string {
  return project.projectNumber ?? project.name
}

function projectSubtitle(project: ProjectsHubProject): string {
  return [project.name, project.clientName, project.address]
    .filter((value): value is string => Boolean(value))
    .join(" · ")
}

function statusLabel(status: string): string {
  const normalized = status.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ")
  if (normalized === "open") return "Active"
  if (normalized === "active") return "Active"
  if (normalized === "in progress") return "Active"
  if (normalized === "current") return "Active"
  if (normalized === "construction") return "Active"
  if (normalized === "warranty") return "Warranty"
  if (normalized === "warranty service") return "Warranty"
  if (normalized === "closed") return "Complete"
  if (normalized === "complete") return "Complete"
  if (normalized === "completed") return "Complete"
  if (normalized === "archived") return "Complete"
  return status
}

function statusBucket(status: string): ProjectStatusBucket {
  const normalized = status.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ")

  if (
    normalized === "open" ||
    normalized === "active" ||
    normalized === "in progress" ||
    normalized === "current" ||
    normalized === "construction" ||
    normalized === "scheduled" ||
    normalized === "preconstruction"
  ) {
    return "active"
  }

  if (normalized.includes("warranty") || normalized.includes("service")) {
    return "warranty"
  }

  if (
    normalized === "closed" ||
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "archived" ||
    normalized === "inactive"
  ) {
    return "complete"
  }

  return "other"
}

function statusFilterLabel(statusFilters: readonly ProjectStatusBucket[]): string {
  if (statusFilters.length === STATUS_FILTERS.length) return "all statuses"

  const labels = STATUS_FILTERS.filter((filter) =>
    statusFilters.includes(filter.id)
  ).map((filter) => filter.label.toLowerCase())

  return labels.join(", ")
}

function googleDriveUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`
}

function projectMatchesSearch(
  project: ProjectsHubProject,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) return true

  const haystack = normalizeSearchValue(
    [
      project.projectNumber,
      project.name,
      project.clientName,
      project.address,
      project.projectManager,
      project.sageJobNumber,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
  )

  return haystack.includes(normalizedQuery)
}

function ProjectCard({
  project,
}: {
  readonly project: ProjectsHubProject
}): React.ReactElement {
  const label = projectLabel(project)
  const subtitle = projectSubtitle(project)

  return (
    <article className="group rounded-lg border bg-background p-3 transition-all duration-200 hover:-translate-y-1 hover:border-emerald-800/35 hover:bg-muted/45 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/dashboard/projects/${project.id}`}
            className="line-clamp-1 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
          >
            {label}
          </Link>
          {subtitle && (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        <Badge variant="outline" className="shrink-0">
          {statusLabel(project.status)}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Link
          href={`/dashboard/projects/${project.id}/schedule`}
          className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent"
        >
          <IconCalendarStats className="size-3.5" />
          Schedule
        </Link>
        <Link
          href={`/dashboard/projects/${project.id}/contacts`}
          className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent"
        >
          <IconAddressBook className="size-3.5" />
          Contacts
        </Link>
        <Link
          href={`/dashboard/projects/${project.id}/budget`}
          className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent"
        >
          <IconFileDollar className="size-3.5" />
          Budget
        </Link>
        {project.googleDriveFolderId && (
          <a
            href={googleDriveUrl(project.googleDriveFolderId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent"
          >
            <IconBrandGoogleDrive className="size-3.5" />
            Drive
          </a>
        )}
      </div>
    </article>
  )
}

function DepartmentLane({
  group,
  activeDepartment,
}: {
  readonly group: DepartmentGroup
  readonly activeDepartment: DepartmentId | "ALL"
}): React.ReactElement {
  const isFiltered = activeDepartment !== "ALL"
  const visibleProjects = isFiltered ? group.projects : group.projects.slice(0, 5)

  return (
    <section
      id={`department-${group.id}`}
      className="scroll-mt-20 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-full border",
                group.accentClassName
              )}
            >
              {group.icon}
            </span>
            <div>
              <h2 className="text-sm font-semibold">{group.label}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {group.description}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{group.projects.length} projects</Badge>
          {!isFiltered && group.projects.length > visibleProjects.length && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/dashboard/projects?department=${group.id}`}>
                View all
              </Link>
            </Button>
          )}
        </div>
      </div>

      {visibleProjects.length > 0 ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {visibleProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No projects in this lane yet.
        </div>
      )}
    </section>
  )
}

function DepartmentButton({
  group,
  active,
  onClick,
}: {
  readonly group: DepartmentGroup
  readonly active: boolean
  readonly onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border bg-background p-3 text-left transition-all duration-200 hover:-translate-y-1 hover:bg-muted/60 hover:shadow-md",
        active && "border-emerald-800/40 bg-muted shadow-sm"
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-full border",
              group.accentClassName
            )}
          >
            {group.icon}
          </span>
          <span>
            <span className="block text-sm font-semibold">{group.shortLabel}</span>
            <span className="text-xs text-muted-foreground">{group.label}</span>
          </span>
        </span>
        <span className="text-lg font-semibold tabular-nums">
          {group.projects.length}
        </span>
      </span>
    </button>
  )
}

export function ProjectsHub({
  projects,
  canCreateOrUpdateProjects,
}: {
  readonly projects: readonly ProjectsHubProject[]
  readonly canCreateOrUpdateProjects: boolean
}): React.ReactElement {
  const searchParams = useSearchParams()
  const [query, setQuery] = React.useState("")
  const [activeDepartment, setActiveDepartment] = React.useState<
    DepartmentId | "ALL"
  >("ALL")
  const [activeStatusFilters, setActiveStatusFilters] = React.useState<
    readonly ProjectStatusBucket[]
  >(["active"])

  React.useEffect(() => {
    const departmentParam = searchParams.get("department")
    const statusParam = searchParams.get("status")

    if (
      departmentParam === "O" ||
      departmentParam === "H" ||
      departmentParam === "N" ||
      departmentParam === "D" ||
      departmentParam === "UNASSIGNED"
    ) {
      setActiveDepartment(departmentParam)
    }

    if (statusParam === "all") {
      setActiveStatusFilters(STATUS_FILTERS.map((filter) => filter.id))
    } else if (statusParam) {
      const requestedFilters = statusParam
        .split(",")
        .filter((value): value is ProjectStatusBucket => {
          return (
            value === "active" ||
            value === "warranty" ||
            value === "complete" ||
            value === "other"
          )
        })
      if (requestedFilters.length > 0) {
        setActiveStatusFilters(Array.from(new Set(requestedFilters)))
      }
    } else {
      setActiveStatusFilters(["active"])
    }
  }, [searchParams])

  function selectStatusFilter(status: ProjectStatusBucket): void {
    setActiveStatusFilters([status])
  }

  const normalizedQuery = normalizeSearchValue(query)
  const statusFilteredProjects = projects.filter((project) =>
    activeStatusFilters.includes(statusBucket(project.status))
  )
  const searchedProjects = statusFilteredProjects.filter((project) =>
    projectMatchesSearch(project, normalizedQuery)
  )
  const groups: readonly DepartmentGroup[] = DEPARTMENTS.map((department) => ({
    ...department,
    projects: searchedProjects.filter(
      (project) => departmentIdForProject(project) === department.id
    ),
  }))
  const visibleGroups =
    activeDepartment === "ALL"
      ? groups.filter(
          (group) => group.projects.length > 0 || group.id !== "UNASSIGNED"
        )
      : groups.filter((group) => group.id === activeDepartment)
  const activeProjects = projects.filter(
    (project) => statusBucket(project.status) === "active"
  )
  const warrantyProjects = projects.filter(
    (project) => statusBucket(project.status) === "warranty"
  )
  const completeProjects = projects.filter(
    (project) => statusBucket(project.status) === "complete"
  )
  const linkedToSageCount = projects.filter((project) =>
    Boolean(project.sageJobNumber)
  ).length
  const linkedToDriveCount = projects.filter((project) =>
    Boolean(project.googleDriveFolderId)
  ).length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b bg-background">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 md:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex size-10 items-center justify-center rounded-full border border-emerald-800/30 bg-emerald-800/10 text-emerald-900">
                <IconCompass className="size-5" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                  Project hub
                </p>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Choose the lane, then the job.
                </h1>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Open Range, HPS, Nu-Tech, and Design projects stay visible from
              one place, with search still cutting directly to the project when
              you already know the number, address, or client.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3">
            <div>
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="mt-1 text-2xl font-semibold">
                {activeProjects.length}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Warranty</p>
              <p className="mt-1 text-2xl font-semibold">
                {warrantyProjects.length}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Complete</p>
              <p className="mt-1 text-2xl font-semibold">
                {completeProjects.length}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xl">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by project number, client, address, Sage job..."
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={activeDepartment === "ALL" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveDepartment("ALL")}
            >
              All departments
            </Button>
            {canCreateOrUpdateProjects && (
              <Button size="sm" variant="outline" asChild>
                <Link href="/dashboard/files">
                  <IconSettingsAutomation className="size-4" />
                  Google setup files
                </Link>
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border bg-muted/25 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
              Status view
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Showing {searchedProjects.length} of {projects.length} projects in{" "}
              {statusFilterLabel(activeStatusFilters)}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.id}
                type="button"
                variant={
                  activeStatusFilters.includes(filter.id)
                    ? "default"
                    : "outline"
                }
                size="sm"
                title={filter.description}
                onClick={() => selectStatusFilter(filter.id)}
              >
                {filter.label}
              </Button>
            ))}
            <Button
              type="button"
              variant={
                activeStatusFilters.length === STATUS_FILTERS.length
                  ? "secondary"
                  : "outline"
              }
              size="sm"
              onClick={() =>
                setActiveStatusFilters(STATUS_FILTERS.map((filter) => filter.id))
              }
            >
              All statuses
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border bg-background p-3">
            <p className="text-xs text-muted-foreground">Sage linked</p>
            <p className="mt-1 text-xl font-semibold">{linkedToSageCount}</p>
          </div>
          <div className="rounded-md border bg-background p-3">
            <p className="text-xs text-muted-foreground">Drive linked</p>
            <p className="mt-1 text-xl font-semibold">{linkedToDriveCount}</p>
          </div>
          <div className="rounded-md border bg-background p-3">
            <p className="text-xs text-muted-foreground">Needs status cleanup</p>
            <p className="mt-1 text-xl font-semibold">
              {
                projects.filter((project) => statusBucket(project.status) === "other")
                  .length
              }
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {groups
            .filter((group) => group.id !== "UNASSIGNED")
            .map((group) => (
              <DepartmentButton
                key={group.id}
                group={group}
                active={activeDepartment === group.id}
                onClick={() => setActiveDepartment(group.id)}
              />
            ))}
        </div>

        {canCreateOrUpdateProjects && (
          <section className="rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">
                  Project creation and registry flow
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  This is the natural home for the Google Apps Script setup:
                  choose O, H, N, or D, create or link the Drive folder, then
                  connect the Compass registry and Sage job.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link href="/dashboard/files">
                    <IconBrandGoogleDrive className="size-4" />
                    Drive files
                  </Link>
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <Link href="/dashboard/projects?department=O">
                    <IconPlus className="size-4" />
                    Start with ORC
                  </Link>
                </Button>
              </div>
            </div>
          </section>
        )}

        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <IconFolder className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">No projects yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              New projects will appear here after the registry is seeded.
            </p>
          </div>
        ) : visibleGroups.length > 0 ? (
          <div className="grid gap-4">
            {visibleGroups.map((group) => (
              <DepartmentLane
                key={group.id}
                group={group}
                activeDepartment={activeDepartment}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <IconSearch className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">No projects match that search.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a project number, client name, address, or Sage job number.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
