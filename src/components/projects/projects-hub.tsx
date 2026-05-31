"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
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
import {
  createProjectShell,
  updateProjectStatus,
  type ProjectStatusValue,
} from "@/app/actions/projects"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

type DepartmentId = "O" | "H" | "N" | "D" | "UNASSIGNED"
type ProjectStatusBucket =
  | "active"
  | "warranty"
  | "complete"
  | "inactive"
  | "archive"
  | "other"

type ProjectStatusOption = {
  readonly value: ProjectStatusValue
  readonly label: string
  readonly bucket: ProjectStatusBucket
}

type DepartmentConfig = {
  readonly id: DepartmentId
  readonly label: string
  readonly shortLabel: string
  readonly description: string
  readonly accentClassName: string
  readonly logoSrc: string | null
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
    accentClassName: "border-[#6f471f] bg-[#6f471f] text-white",
    logoSrc: "/department-logos/orc-mark.png",
    icon: <IconHome className="size-4" />,
  },
  {
    id: "H",
    label: "HPS Projects",
    shortLabel: "HPS",
    description: "High Performance Structures work and internal construction.",
    accentClassName: "border-[#3f7d4d] bg-[#3f7d4d] text-white",
    logoSrc: "/department-logos/hps-h-green.svg",
    icon: <IconBuildingCommunity className="size-4" />,
  },
  {
    id: "N",
    label: "Nu-Tech Projects",
    shortLabel: "Nu-Tech",
    description: "ICF sales, bracing rental, support, and related projects.",
    accentClassName: "border-[#9d832c] bg-[#9d832c] text-white",
    logoSrc: "/department-logos/nu-tech-n.png",
    icon: <IconTool className="size-4" />,
  },
  {
    id: "D",
    label: "Design Projects",
    shortLabel: "Design",
    description: "Design-only scopes, drafting, estimating, and handoff work.",
    accentClassName: "border-[#6f471f] bg-[#6f471f] text-white",
    logoSrc: "/department-logos/orc-mark.png",
    icon: <IconPaint className="size-4" />,
  },
  {
    id: "UNASSIGNED",
    label: "Unassigned",
    shortLabel: "Other",
    description: "Projects that still need an O, H, N, or D project number.",
    accentClassName: "border-muted-foreground/25 bg-muted text-muted-foreground",
    logoSrc: null,
    icon: <IconFolder className="size-4" />,
  },
]

const STATUS_FILTERS: readonly StatusFilterConfig[] = [
  {
    id: "active",
    label: "Active",
    description: "Current work and day-to-day jobs.",
  },
  {
    id: "warranty",
    label: "Warranty",
    description: "Completed jobs still carrying warranty or service attention.",
  },
  {
    id: "complete",
    label: "Complete",
    description: "Completed projects still kept in regular project records.",
  },
  {
    id: "inactive",
    label: "Inactive",
    description: "Paused work that should not appear in day-to-day active views.",
  },
  {
    id: "archive",
    label: "Archive",
    description: "Historical projects kept for reference.",
  },
  {
    id: "other",
    label: "Other",
    description: "Imported statuses that need cleanup or mapping.",
  },
]

const PROJECT_STATUS_OPTIONS: readonly ProjectStatusOption[] = [
  { value: "OPEN", label: "Active", bucket: "active" },
  { value: "WARRANTY", label: "Warranty", bucket: "warranty" },
  { value: "COMPLETE", label: "Complete", bucket: "complete" },
  { value: "INACTIVE", label: "Inactive", bucket: "inactive" },
  { value: "ARCHIVE", label: "Archive", bucket: "archive" },
  { value: "OTHER", label: "Other", bucket: "other" },
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
  if (normalized === "inactive") return "Inactive"
  if (normalized === "paused") return "Inactive"
  if (normalized === "archive") return "Archive"
  if (normalized === "archived") return "Archive"
  if (normalized === "closed") return "Complete"
  if (normalized === "complete") return "Complete"
  if (normalized === "completed") return "Complete"
  if (normalized === "other") return "Other"
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

  if (normalized === "inactive" || normalized === "paused") {
    return "inactive"
  }

  if (normalized === "archive" || normalized === "archived") {
    return "archive"
  }

  if (
    normalized === "closed" ||
    normalized === "complete" ||
    normalized === "completed"
  ) {
    return "complete"
  }

  return "other"
}

function projectStatusValue(status: string): ProjectStatusValue {
  const normalized = status.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")
  const option = PROJECT_STATUS_OPTIONS.find((item) => item.value === normalized)
  if (option) return option.value

  const bucket = statusBucket(status)
  const bucketOption = PROJECT_STATUS_OPTIONS.find(
    (item) => item.bucket === bucket
  )
  return bucketOption?.value ?? "OTHER"
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

function departmentBorderClassName(departmentId: DepartmentId): string {
  switch (departmentId) {
    case "O":
      return "border-l-[#6f471f]"
    case "H":
      return "border-l-[#3f7d4d]"
    case "N":
      return "border-l-[#9d832c]"
    case "D":
      return "border-l-[#6f471f]"
    case "UNASSIGNED":
      return "border-l-muted-foreground"
  }
}

function departmentHeaderClassName(departmentId: DepartmentId): string {
  switch (departmentId) {
    case "O":
      return "border-[#6f471f]/60 bg-card"
    case "H":
      return "border-[#3f7d4d]/60 bg-card"
    case "N":
      return "border-[#9d832c]/60 bg-card"
    case "D":
      return "border-[#6f471f]/60 bg-card"
    case "UNASSIGNED":
      return "border-muted bg-muted/30"
  }
}

function departmentTabClassName(departmentId: DepartmentId): string {
  switch (departmentId) {
    case "O":
      return "border-b-[#6f471f] text-[#6f471f]"
    case "H":
      return "border-b-[#3f7d4d] text-[#3f7d4d]"
    case "N":
      return "border-b-[#9d832c] text-[#715d1c]"
    case "D":
      return "border-b-[#6f471f] text-[#6f471f]"
    case "UNASSIGNED":
      return "border-b-muted-foreground"
  }
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

function DepartmentMark({
  department,
  size = "md",
}: {
  readonly department: DepartmentConfig
  readonly size?: "sm" | "md"
}): React.ReactElement {
  const sizeClassName = size === "sm" ? "size-7" : "size-8"

  if (department.logoSrc) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center overflow-hidden rounded-[4px] border bg-background shadow-sm",
          sizeClassName
        )}
      >
        <img
          src={department.logoSrc}
          alt={`${department.shortLabel} logo`}
          className="size-full object-contain p-0.5"
        />
      </span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-[4px] border shadow-sm",
        sizeClassName,
        department.accentClassName
      )}
    >
      {department.icon}
    </span>
  )
}

function ProjectStatusSelect({
  projectId,
  currentStatus,
  projectLabelText,
}: {
  readonly projectId: string
  readonly currentStatus: string
  readonly projectLabelText: string
}): React.ReactElement {
  const router = useRouter()
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null)
  const [isUpdatingStatus, startStatusTransition] = React.useTransition()

  function selectProjectStatus(nextStatus: string): void {
    const statusOption = PROJECT_STATUS_OPTIONS.find(
      (option) => option.value === nextStatus
    )
    if (!statusOption) return

    setStatusMessage(null)
    startStatusTransition(async () => {
      const result = await updateProjectStatus(projectId, statusOption.value)
      if (!result.success) {
        setStatusMessage(result.error)
        return
      }

      router.refresh()
    })
  }

  return (
    <div className="shrink-0">
      <Select
        value={projectStatusValue(currentStatus)}
        onValueChange={selectProjectStatus}
        disabled={isUpdatingStatus}
      >
        <SelectTrigger
          size="sm"
          className="h-7 w-[7.5rem] bg-background text-xs"
          aria-label={`Change status for ${projectLabelText}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {PROJECT_STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {statusMessage && (
        <p className="mt-1 text-xs text-destructive">{statusMessage}</p>
      )}
    </div>
  )
}

function ProjectCard({
  project,
  canUpdateStatus,
}: {
  readonly project: ProjectsHubProject
  readonly canUpdateStatus: boolean
}): React.ReactElement {
  const label = projectLabel(project)
  const subtitle = projectSubtitle(project)
  const departmentId = departmentIdForProject(project)
  const actionClassName =
    "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"

  return (
    <article
      className={cn(
        "group rounded-md border border-l-[6px] bg-card px-3 py-2.5 shadow-sm transition-colors hover:bg-muted/55",
        departmentBorderClassName(departmentId)
      )}
    >
      <div className="flex items-start justify-between gap-4">
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
        {canUpdateStatus ? (
          <ProjectStatusSelect
            projectId={project.id}
            currentStatus={project.status}
            projectLabelText={label}
          />
        ) : (
          <span className="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
            {statusLabel(project.status)}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t pt-2">
        <Link
          href={`/dashboard/projects/${project.id}/schedule`}
          className={actionClassName}
        >
          <IconCalendarStats className="size-3.5" />
          Schedule
        </Link>
        <Link
          href={`/dashboard/projects/${project.id}/contacts`}
          className={actionClassName}
        >
          <IconAddressBook className="size-3.5" />
          Contacts
        </Link>
        <Link
          href={`/dashboard/projects/${project.id}/budget`}
          className={actionClassName}
        >
          <IconFileDollar className="size-3.5" />
          Budget
        </Link>
        {project.googleDriveFolderId && (
          <a
            href={googleDriveUrl(project.googleDriveFolderId)}
            target="_blank"
            rel="noreferrer"
            className={actionClassName}
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
  canUpdateStatus,
}: {
  readonly group: DepartmentGroup
  readonly activeDepartment: DepartmentId | "ALL"
  readonly canUpdateStatus: boolean
}): React.ReactElement {
  const isFiltered = activeDepartment !== "ALL"
  const visibleProjects = isFiltered ? group.projects : group.projects.slice(0, 5)

  return (
    <section
      id={`department-${group.id}`}
      className={cn(
        "clarity-panel-strong scroll-mt-20 overflow-hidden border-l-[8px]",
        departmentBorderClassName(group.id),
        departmentHeaderClassName(group.id)
      )}
    >
      <div className="clarity-section-header flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <DepartmentMark department={group} />
            <div>
              <h2 className="text-sm font-semibold">{group.label}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {group.description}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tabular-nums">
            {group.projects.length}
            <span className="ml-1 text-xs font-medium text-muted-foreground">
              projects
            </span>
          </span>
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
        <div className="grid gap-3 p-3 xl:grid-cols-2">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              canUpdateStatus={canUpdateStatus}
            />
          ))}
        </div>
      ) : (
        <div className="m-3 rounded-md border border-dashed bg-background/70 p-4 text-sm text-muted-foreground">
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
        "border-b-2 border-r border-transparent bg-card px-3 py-3 text-left transition-colors last:border-r-0 hover:bg-muted/55",
        active
          ? cn("bg-muted/70 shadow-[inset_0_-3px_0_currentColor]", departmentTabClassName(group.id))
          : "text-muted-foreground"
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <DepartmentMark department={group} size="sm" />
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
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = React.useState("")
  const [isCreatingProject, startCreateProjectTransition] =
    React.useTransition()
  const [showCreateProject, setShowCreateProject] = React.useState(false)
  const [newProjectDepartment, setNewProjectDepartment] =
    React.useState<DepartmentId>("O")
  const [registryProjectQuery, setRegistryProjectQuery] = React.useState("")
  const [createProjectMessage, setCreateProjectMessage] =
    React.useState<string | null>(null)
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
            value === "inactive" ||
            value === "archive" ||
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

  function createProjectFromForm(
    event: React.FormEvent<HTMLFormElement>
  ): void {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get("name") ?? "").trim()
    const clientName = String(formData.get("clientName") ?? "").trim()
    const address = String(formData.get("address") ?? "").trim()

    setCreateProjectMessage(null)
    startCreateProjectTransition(async () => {
      const result = await createProjectShell({
        projectNumber: null,
        name,
        department: newProjectDepartment,
        clientName: clientName.length > 0 ? clientName : null,
        address: address.length > 0 ? address : null,
        status: "OPEN",
      })

      if (!result.success) {
        setCreateProjectMessage(result.error)
        return
      }

      form.reset()
      setCreateProjectMessage("Project shell created.")
      router.push(`/dashboard/projects/${result.id}`)
      router.refresh()
    })
  }

  const normalizedQuery = normalizeSearchValue(query)
  const normalizedRegistryProjectQuery = normalizeSearchValue(registryProjectQuery)
  const registryProjectMatches = normalizedRegistryProjectQuery
    ? projects
        .filter((project) =>
          projectMatchesSearch(project, normalizedRegistryProjectQuery)
        )
        .slice(0, 6)
    : []
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
                  Choose the department, then the job.
                </h1>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Open Range, HPS, Nu-Tech, and Design projects stay visible from
              one place, with search still cutting directly to the project when
              you already know the number, address, or client.
            </p>
          </div>

          <div className="clarity-panel grid grid-cols-3 divide-x text-center">
            <div className="px-3 py-2">
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="mt-1 text-xl font-semibold">
                {activeProjects.length}
              </p>
            </div>
            <div className="px-3 py-2">
              <p className="text-xs text-muted-foreground">Warranty</p>
              <p className="mt-1 text-xl font-semibold">
                {warrantyProjects.length}
              </p>
            </div>
            <div className="px-3 py-2">
              <p className="text-xs text-muted-foreground">Complete</p>
              <p className="mt-1 text-xl font-semibold">
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
              placeholder="Search by project number, client, address, or accounting job..."
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

        <div className="clarity-panel flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
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

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-muted/20 px-4 py-2 text-sm">
          <span>
            <span className="font-semibold tabular-nums">{linkedToSageCount}</span>{" "}
            <span className="text-muted-foreground">accounting linked</span>
          </span>
          <span>
            <span className="font-semibold tabular-nums">{linkedToDriveCount}</span>{" "}
            <span className="text-muted-foreground">Drive linked</span>
          </span>
          <span>
            <span className="font-semibold tabular-nums">
              {
                projects.filter((project) => statusBucket(project.status) === "other")
                  .length
              }
            </span>{" "}
            <span className="text-muted-foreground">need status cleanup</span>
          </span>
        </div>

        <div className="clarity-panel grid overflow-hidden md:grid-cols-2 xl:grid-cols-4">
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
          <section className="clarity-panel-strong overflow-hidden">
            <div className="clarity-section-header flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">
                  Create or Update an Existing Project
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Create a new Compass shell or open an existing job to update
                  its Drive, Sage, Buildertrend, and registry links.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link href="/dashboard/files">
                    <IconBrandGoogleDrive className="size-4" />
                    Drive files
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    setShowCreateProject((open) => !open)
                    setNewProjectDepartment("O")
                  }}
                >
                  <IconPlus className="size-4" />
                  Create project
                </Button>
              </div>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              {showCreateProject && (
                <form
                  className="rounded-md border bg-card p-3"
                  onSubmit={createProjectFromForm}
                >
                  <div>
                    <h3 className="text-sm font-semibold">Create new project</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Choose the department. Compass will create the shell first;
                      the project number can be assigned in the registry step.
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {DEPARTMENTS.filter((department) => department.id !== "UNASSIGNED").map(
                      (department) => (
                        <Button
                          key={department.id}
                          type="button"
                          size="sm"
                          variant={
                            newProjectDepartment === department.id
                              ? "default"
                              : "outline"
                          }
                          onClick={() => setNewProjectDepartment(department.id)}
                        >
                          {department.shortLabel}
                        </Button>
                      )
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <Input
                      name="name"
                      placeholder="Project name"
                      aria-label="Project name"
                      required
                    />
                    <Input
                      name="clientName"
                      placeholder="Client"
                      aria-label="Client"
                    />
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <Input
                      name="address"
                      placeholder="Address"
                      aria-label="Address"
                    />
                    <Button type="submit" disabled={isCreatingProject}>
                      {isCreatingProject ? "Creating..." : "Create Shell"}
                    </Button>
                  </div>
                  {createProjectMessage && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {createProjectMessage}
                    </p>
                  )}
                </form>
              )}

              <div className="rounded-md border bg-card p-3">
                <div>
                  <h3 className="text-sm font-semibold">Update existing project</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Search by project number, client, address, or accounting job.
                  </p>
                </div>
                <div className="relative mt-3">
                  <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={registryProjectQuery}
                    onChange={(event) => setRegistryProjectQuery(event.target.value)}
                    placeholder="Find project to update..."
                    aria-label="Find project to update"
                    className="pl-9"
                  />
                </div>
                <div className="mt-3 divide-y rounded-md border">
                  {registryProjectMatches.length > 0 ? (
                    registryProjectMatches.map((project) => (
                      <div
                        key={project.id}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/65"
                      >
                        <Link
                          href={`/dashboard/projects/${project.id}`}
                          className="min-w-0 flex-1"
                        >
                          <span className="block truncate font-medium">
                            {projectLabel(project)}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {projectSubtitle(project) || statusLabel(project.status)}
                          </span>
                        </Link>
                        <ProjectStatusSelect
                          projectId={project.id}
                          currentStatus={project.status}
                          projectLabelText={projectLabel(project)}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="px-3 py-4 text-sm text-muted-foreground">
                      {normalizedRegistryProjectQuery
                        ? "No projects match that search."
                        : "Start typing to find a project."}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <IconFolder className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">No projects yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No projects match this view yet.
            </p>
          </div>
        ) : visibleGroups.length > 0 ? (
          <div className="grid gap-4">
            {visibleGroups.map((group) => (
              <DepartmentLane
                key={group.id}
                group={group}
                activeDepartment={activeDepartment}
                canUpdateStatus={canCreateOrUpdateProjects}
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
