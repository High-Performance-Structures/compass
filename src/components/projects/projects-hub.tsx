"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  IconAddressBook,
  IconArrowLeft,
  IconBrandGoogleDrive,
  IconBuildingCommunity,
  IconCalendarStats,
  IconCompass,
  IconExternalLink,
  IconFileDollar,
  IconFolder,
  IconHome,
  IconPaint,
  IconPlus,
  IconSearch,
  IconSettingsAutomation,
  IconSparkles,
  IconTool,
} from "@tabler/icons-react"

import type { ProjectsHubProject } from "@/app/dashboard/projects/page"
import {
  createProjectShell,
  updateProjectStatus,
  type ProjectStatusValue,
} from "@/app/actions/projects"
import { updateProjectRegistry } from "@/app/actions/project-registry"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  readonly allProjects: readonly ProjectsHubProject[]
}

type DepartmentTool = {
  readonly label: string
  readonly description: string
  readonly kind: "project-manager" | "link"
  readonly href: string | null
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

const HPS_PROJECT_MANAGER_EDITOR_URL =
  "https://script.google.com/d/1NzKjO6r_WS5optIHxwGxB5mby3PX0TSHhctU73xZIFtWXXgLueksPN-s/edit"

const DEFAULT_HPS_PROJECT_MANAGER_WEB_APP_URL =
  "https://script.google.com/a/macros/hps-colorado.com/s/AKfycbyeCqsdObrPp91LRmpEHSLZ8xdGerw7ExF2mFSSzYkxGnTrliv9OvHsYOFXicnVC5nQ/exec"

const CONFIGURED_HPS_PROJECT_MANAGER_WEB_APP_URL =
  process.env.NEXT_PUBLIC_HPS_PROJECT_MANAGER_WEB_APP_URL ?? ""

const HPS_PROJECT_MANAGER_WEB_APP_URL =
  CONFIGURED_HPS_PROJECT_MANAGER_WEB_APP_URL ||
  DEFAULT_HPS_PROJECT_MANAGER_WEB_APP_URL
const DASHBOARD_MODE_STORAGE_KEY = "compass-dashboard-workspace-mode"

const DEPARTMENT_TOOLS: readonly (DepartmentTool & {
  readonly departments: readonly DepartmentId[]
})[] = [
  {
    departments: ["O", "H", "D"],
    label: "HPS Project Manager",
    description: "Project numbers, Drive folders, and tracker updates.",
    kind: "project-manager",
    href: null,
  },
  {
    departments: ["N"],
    label: "Nu-Tech PO Order Manager",
    description: "Google-side order intake while Compass PO tools mature.",
    kind: "link",
    href: "/dashboard/automations",
  },
  {
    departments: ["D"],
    label: "Finish Schedule Generator",
    description: "Selections and finish schedule handoff work.",
    kind: "link",
    href: "/dashboard/automations",
  },
  {
    departments: ["O", "H", "N", "D"],
    label: "Automation Center",
    description: "Google scripts, handoffs, and transition tools.",
    kind: "link",
    href: "/dashboard/automations",
  },
]

function openProjectManagerWorkWindow(appUrl: string): void {
  const projectManagerWindow = window.open(
    appUrl,
    "hps-project-manager",
    "popup=yes,width=1180,height=860,menubar=no,toolbar=yes,location=yes,status=no,scrollbars=yes,resizable=yes"
  )

  if (projectManagerWindow) {
    projectManagerWindow.focus()
  }
}

function storedDashboardDeveloperMode(canUseDeveloperMode: boolean): boolean {
  if (!canUseDeveloperMode) return false

  try {
    return window.localStorage.getItem(DASHBOARD_MODE_STORAGE_KEY) === "developer"
  } catch {
    return false
  }
}

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

function departmentRingClassName(departmentId: DepartmentId): string {
  switch (departmentId) {
    case "O":
      return "ring-[#6f471f]/35"
    case "H":
      return "ring-[#3f7d4d]/35"
    case "N":
      return "ring-[#9d832c]/35"
    case "D":
      return "ring-[#6f471f]/35"
    case "UNASSIGNED":
      return "ring-muted-foreground/25"
  }
}

function departmentSurfaceClassName(departmentId: DepartmentId): string {
  switch (departmentId) {
    case "O":
      return "border-[#6f471f]/40 bg-[#6f471f]/10 hover:bg-[#6f471f]/15"
    case "H":
      return "border-[#3f7d4d]/40 bg-[#3f7d4d]/10 hover:bg-[#3f7d4d]/15"
    case "N":
      return "border-[#9d832c]/40 bg-[#9d832c]/10 hover:bg-[#9d832c]/15"
    case "D":
      return "border-[#6f471f]/40 bg-[#6f471f]/10 hover:bg-[#6f471f]/15"
    case "UNASSIGNED":
      return "border-muted bg-muted/25 hover:bg-muted/35"
  }
}

function toolsForDepartment(departmentId: DepartmentId): readonly DepartmentTool[] {
  return DEPARTMENT_TOOLS.filter((tool) =>
    tool.departments.includes(departmentId)
  )
}

function countByStatusBucket(
  projects: readonly ProjectsHubProject[],
  bucket: ProjectStatusBucket
): number {
  return projects.filter((project) => statusBucket(project.status) === bucket)
    .length
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

function RegistryTextField({
  label,
  name,
  value,
  placeholder,
}: {
  readonly label: string
  readonly name: string
  readonly value: string | null
  readonly placeholder?: string
}): React.ReactElement {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <Input
        name={name}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        className="h-9 bg-background text-sm font-normal text-foreground"
      />
    </label>
  )
}

function RegistrySelectField({
  label,
  name,
  value,
  options,
}: {
  readonly label: string
  readonly name: string
  readonly value: string
  readonly options: readonly {
    readonly value: string
    readonly label: string
  }[]
}): React.ReactElement {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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
  const activeCount = countByStatusBucket(group.allProjects, "active")
  const warrantyCount = countByStatusBucket(group.allProjects, "warranty")
  const completeCount = countByStatusBucket(group.allProjects, "complete")

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex min-h-[11rem] flex-col rounded-lg border p-4 text-left shadow-sm transition-colors hover:border-foreground/20 hover:shadow-md",
        departmentSurfaceClassName(group.id),
        active
          ? cn(
              "ring-2 ring-offset-2 ring-offset-background",
              departmentRingClassName(group.id)
            )
          : "text-foreground"
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <DepartmentMark department={group} />
          <span>
            <span className="block text-base font-semibold">
              {group.shortLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              {group.label}
            </span>
          </span>
        </span>
        <span className="rounded-md border bg-background/80 px-2 py-1 text-sm font-semibold tabular-nums">
          {activeCount}
          <span className="ml-1 text-xs font-medium text-muted-foreground">
            active
          </span>
        </span>
      </span>
      <span className="mt-4 block text-sm leading-6 text-muted-foreground">
        {group.description}
      </span>
      <span className="mt-auto grid grid-cols-3 gap-2 pt-4 text-center text-xs">
        <span className="rounded-md border bg-background/70 px-2 py-1.5">
          <span className="block font-semibold tabular-nums">
            {group.allProjects.length}
          </span>
          <span className="text-muted-foreground">Total</span>
        </span>
        <span className="rounded-md border bg-background/70 px-2 py-1.5">
          <span className="block font-semibold tabular-nums">
            {warrantyCount}
          </span>
          <span className="text-muted-foreground">Warranty</span>
        </span>
        <span className="rounded-md border bg-background/70 px-2 py-1.5">
          <span className="block font-semibold tabular-nums">
            {completeCount}
          </span>
          <span className="text-muted-foreground">Complete</span>
        </span>
      </span>
    </button>
  )
}

function DepartmentToolButton({
  tool,
  onOpenProjectManager,
}: {
  readonly tool: DepartmentTool
  readonly onOpenProjectManager: () => void
}): React.ReactElement {
  if (tool.kind === "project-manager") {
    return (
      <Button type="button" variant="outline" onClick={onOpenProjectManager}>
        <IconSettingsAutomation className="size-4" />
        {tool.label}
      </Button>
    )
  }

  if (!tool.href) {
    return (
      <Button type="button" variant="outline" disabled>
        {tool.label}
      </Button>
    )
  }

  return (
    <Button variant="outline" asChild>
      <Link href={tool.href}>
        <IconExternalLink className="size-4" />
        {tool.label}
      </Link>
    </Button>
  )
}

function DepartmentLanding({
  group,
  canUpdateStatus,
  canOpenTools,
  onOpenProjectManager,
}: {
  readonly group: DepartmentGroup
  readonly canUpdateStatus: boolean
  readonly canOpenTools: boolean
  readonly onOpenProjectManager: () => void
}): React.ReactElement {
  const tools = toolsForDepartment(group.id)
  const activeCount = countByStatusBucket(group.allProjects, "active")
  const warrantyCount = countByStatusBucket(group.allProjects, "warranty")
  const completeCount = countByStatusBucket(group.allProjects, "complete")
  const needsStatusCleanupCount = countByStatusBucket(group.allProjects, "other")

  return (
    <section
      className={cn(
        "clarity-panel-strong overflow-hidden border-l-[8px]",
        departmentBorderClassName(group.id),
        departmentHeaderClassName(group.id)
      )}
    >
      <div className="grid gap-4 border-b bg-background/70 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <DepartmentMark department={group} />
            <div>
              <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Department hub
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">
                {group.label}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {group.description}
              </p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 overflow-hidden rounded-md border bg-card text-center text-xs">
          <div className="border-r px-2 py-2">
            <p className="text-muted-foreground">Active</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {activeCount}
            </p>
          </div>
          <div className="border-r px-2 py-2">
            <p className="text-muted-foreground">Warranty</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {warrantyCount}
            </p>
          </div>
          <div className="border-r px-2 py-2">
            <p className="text-muted-foreground">Complete</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {completeCount}
            </p>
          </div>
          <div className="px-2 py-2">
            <p className="text-muted-foreground">Other</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {needsStatusCleanupCount}
            </p>
          </div>
        </div>
      </div>

      {canOpenTools && tools.length > 0 && (
        <div className="border-b bg-muted/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Quick tools</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Department scripts and handoff utilities.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {tools.map((tool) => (
                <DepartmentToolButton
                  key={tool.label}
                  tool={tool}
                  onOpenProjectManager={onOpenProjectManager}
                />
              ))}
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {tools.map((tool) => (
              <div
                key={`${tool.label}-detail`}
                className="rounded-md border bg-background/75 px-3 py-2"
              >
                <p className="text-sm font-medium">{tool.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {tool.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Projects</h3>
          <p className="text-xs text-muted-foreground">
            {group.projects.length} shown from {group.allProjects.length} total.
          </p>
        </div>
        {group.projects.length > 0 ? (
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {group.projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                canUpdateStatus={canUpdateStatus}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-dashed bg-background/70 p-6 text-center text-sm text-muted-foreground">
            No projects match this department view.
          </div>
        )}
      </div>
    </section>
  )
}

function ProjectManagerEmbedDialog({
  open,
  onOpenChange,
  appUrl,
  embedUrl,
  urlInput,
  onUrlInputChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly appUrl: string
  readonly embedUrl: string | null
  readonly urlInput: string
  readonly onUrlInputChange: (value: string) => void
}): React.ReactElement {
  const handleOpenDetachedWindow = React.useCallback(() => {
    openProjectManagerWorkWindow(appUrl)
  }, [appUrl])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,900px)] max-w-[min(96vw,1180px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3 text-left">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <DialogTitle>HPS Project Manager</DialogTitle>
              <DialogDescription>
                Google project setup for numbering, Drive folders, and tracker
                updates.
              </DialogDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleOpenDetachedWindow}>
                <IconExternalLink className="size-4" />
                Open work window
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={appUrl} target="_blank" rel="noreferrer">
                  <IconExternalLink className="size-4" />
                  Open app tab
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a
                  href={HPS_PROJECT_MANAGER_EDITOR_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  <IconExternalLink className="size-4" />
                  Script editor
                </a>
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="border-b bg-muted/25 px-4 py-3">
          <label className="text-xs font-medium text-muted-foreground">
            Deployed web app URL
          </label>
          <Input
            value={urlInput}
            onChange={(event) => onUrlInputChange(event.target.value)}
            placeholder={
              HPS_PROJECT_MANAGER_WEB_APP_URL
                ? HPS_PROJECT_MANAGER_WEB_APP_URL
                : "Paste the Apps Script /macros/s/.../exec URL"
            }
            className="mt-1"
          />
          {!embedUrl && (
            <p className="mt-2 text-xs text-muted-foreground">
              The current HPS-domain deployment opens cleanly in a tab, but
              Google blocks its sign-in redirect inside a Compass iframe. Paste
              a new embed-capable /exec URL here to test it in this browser
              session.
            </p>
          )}
        </div>

        {embedUrl ? (
          <iframe
            title="HPS Project Manager"
            src={embedUrl}
            className="min-h-0 flex-1 border-0 bg-background"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
            <div className="w-full max-w-2xl overflow-hidden rounded-md border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#d14b3a]" />
                  <span className="size-2 rounded-full bg-[#d8a742]" />
                  <span className="size-2 rounded-full bg-[#3f7d4d]" />
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  Secure Google window
                </span>
              </div>
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-sm border bg-background text-[#3f7d4d]">
                    <IconSettingsAutomation className="size-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold">
                      Project setup opens in a focused work window
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Google blocks this HPS-domain app from rendering directly
                      inside Compass during sign-in. The work window keeps the
                      flow beside Compass while we replace this with a native
                      Compass project setup screen.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <Button onClick={handleOpenDetachedWindow}>
                        <IconExternalLink className="size-4" />
                        Open work window
                      </Button>
                      <Button variant="outline" asChild>
                        <a href={appUrl} target="_blank" rel="noreferrer">
                          Open in new tab
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="border-t bg-muted/25 px-6 py-3 text-xs text-muted-foreground">
                True in-Compass editing will need a Compass-native bridge to the
                project registry and Drive folder script logic.
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
  const [isSavingRegistry, startSaveRegistryTransition] = React.useTransition()
  const [showCreateProject, setShowCreateProject] = React.useState(false)
  const [newProjectDepartment, setNewProjectDepartment] =
    React.useState<DepartmentId>("O")
  const [registryProjectQuery, setRegistryProjectQuery] = React.useState("")
  const [selectedRegistryProjectId, setSelectedRegistryProjectId] =
    React.useState<string | null>(null)
  const [createProjectMessage, setCreateProjectMessage] =
    React.useState<string | null>(null)
  const [registryMessage, setRegistryMessage] = React.useState<string | null>(
    null
  )
  const [projectManagerOpen, setProjectManagerOpen] = React.useState(false)
  const [projectManagerUrlInput, setProjectManagerUrlInput] =
    React.useState("")
  const [developerModeEnabled, setDeveloperModeEnabled] = React.useState(false)
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
    } else {
      setActiveDepartment("ALL")
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

  React.useEffect(() => {
    setDeveloperModeEnabled(
      storedDashboardDeveloperMode(canCreateOrUpdateProjects)
    )
  }, [canCreateOrUpdateProjects])

  function selectStatusFilter(status: ProjectStatusBucket): void {
    setActiveStatusFilters([status])
  }

  function selectDepartment(department: DepartmentId | "ALL"): void {
    setActiveDepartment(department)
    const params = new URLSearchParams(searchParams.toString())
    if (department === "ALL") {
      params.delete("department")
    } else {
      params.set("department", department)
    }

    const nextUrl = params.toString()
      ? `/dashboard/projects?${params.toString()}`
      : "/dashboard/projects"
    router.replace(nextUrl, { scroll: false })
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

  function updateRegistryFromForm(
    event: React.FormEvent<HTMLFormElement>
  ): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const selectedProjectId = selectedRegistryProjectId

    if (!selectedProjectId) return

    setRegistryMessage(null)
    startSaveRegistryTransition(async () => {
      const result = await updateProjectRegistry(selectedProjectId, formData)
      if (!result.success) {
        setRegistryMessage(result.error)
        return
      }

      setRegistryMessage("Project registry updated.")
      router.refresh()
    })
  }

  const normalizedQuery = normalizeSearchValue(query)
  const normalizedRegistryProjectQuery = normalizeSearchValue(registryProjectQuery)
  const projectManagerAppUrl =
    projectManagerUrlInput.trim() || HPS_PROJECT_MANAGER_WEB_APP_URL
  const showProjectManagerDeveloperDialog =
    canCreateOrUpdateProjects && developerModeEnabled
  const projectManagerEmbedUrl =
    projectManagerUrlInput.trim() ||
    CONFIGURED_HPS_PROJECT_MANAGER_WEB_APP_URL.trim() ||
    null
  const registryProjectMatches = normalizedRegistryProjectQuery
    ? projects
        .filter((project) =>
          projectMatchesSearch(project, normalizedRegistryProjectQuery)
        )
        .slice(0, 6)
    : []
  const selectedRegistryProject = selectedRegistryProjectId
    ? projects.find((project) => project.id === selectedRegistryProjectId) ?? null
    : null
  const statusFilteredProjects = projects.filter((project) =>
    activeStatusFilters.includes(statusBucket(project.status))
  )
  const searchedProjects = statusFilteredProjects.filter((project) =>
    projectMatchesSearch(project, normalizedQuery)
  )
  const groups: readonly DepartmentGroup[] = DEPARTMENTS.map((department) => ({
    ...department,
    allProjects: projects.filter(
      (project) => departmentIdForProject(project) === department.id
    ),
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
  const selectedDepartmentGroup =
    activeDepartment === "ALL"
      ? null
      : groups.find((group) => group.id === activeDepartment) ?? null

  function openProjectManager(): void {
    openProjectManagerWorkWindow(projectManagerAppUrl)
  }

  function openProjectManagerDetails(): void {
    setProjectManagerOpen(true)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {showProjectManagerDeveloperDialog && (
        <ProjectManagerEmbedDialog
          open={projectManagerOpen}
          onOpenChange={setProjectManagerOpen}
          appUrl={projectManagerAppUrl}
          embedUrl={projectManagerEmbedUrl}
          urlInput={projectManagerUrlInput}
          onUrlInputChange={setProjectManagerUrlInput}
        />
      )}
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
              placeholder={
                selectedDepartmentGroup
                  ? `Search ${selectedDepartmentGroup.shortLabel} projects...`
                  : "Search by project number, client, address, or accounting job..."
              }
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={activeDepartment === "ALL" ? "default" : "outline"}
              size="sm"
              onClick={() => selectDepartment("ALL")}
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

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {groups
            .filter((group) => group.id !== "UNASSIGNED")
            .map((group) => (
              <DepartmentButton
                key={group.id}
                group={group}
                active={activeDepartment === group.id}
                onClick={() => selectDepartment(group.id)}
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
                  Use the HPS Project Manager workflow for project numbering,
                  Drive provisioning, and tracker updates. Compass stores the
                  resulting links and accounting IDs after it runs.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="default"
                  type="button"
                  onClick={openProjectManager}
                >
                  <IconSettingsAutomation className="size-4" />
                  HPS Project Manager
                </Button>
                {showProjectManagerDeveloperDialog && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={openProjectManagerDetails}
                    >
                      <IconExternalLink className="size-4" />
                      Script details
                    </Button>
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
                  </>
                )}
              </div>
            </div>
            {showProjectManagerDeveloperDialog && (
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              {showCreateProject && (
                <form
                  className="rounded-md border bg-card p-3"
                  onSubmit={createProjectFromForm}
                >
                  <div>
                    <h3 className="text-sm font-semibold">Create new project</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This only creates a Compass shell. Use HPS Project
                      Manager when the job also needs official
                      numbering, folders, and tracker rows.
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
                  <h3 className="text-sm font-semibold">
                    Update Compass registry
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Search for a Compass job, then paste or confirm the IDs
                    produced by the HPS Project Manager workflow.
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
                        className={cn(
                          "flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/65",
                          selectedRegistryProjectId === project.id &&
                            "bg-muted/70"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRegistryProjectId(project.id)
                            setRegistryMessage(null)
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate font-medium">
                            {projectLabel(project)}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {projectSubtitle(project) || statusLabel(project.status)}
                          </span>
                        </button>
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
                {selectedRegistryProject && (
                  <form
                    key={selectedRegistryProject.id}
                    className="mt-4 border-t pt-4"
                    onSubmit={updateRegistryFromForm}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold">
                          Compass registry for {projectLabel(selectedRegistryProject)}
                        </h4>
                        <p className="mt-1 text-xs text-muted-foreground">
                          These fields record the project number, Drive folder,
                          and handoff IDs created by the HPS Project Manager
                          workflow or by Sage/Buildertrend.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={openProjectManager}
                        >
                          <IconSettingsAutomation className="size-4" />
                          Open Project Manager
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            href={`/dashboard/projects/${selectedRegistryProject.id}`}
                          >
                            Open project
                          </Link>
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <RegistryTextField
                        label="Project number"
                        name="projectNumber"
                        value={selectedRegistryProject.projectNumber}
                        placeholder="O-### or H-###"
                      />
                      <RegistrySelectField
                        label="Status"
                        name="status"
                        value={projectStatusValue(selectedRegistryProject.status)}
                        options={PROJECT_STATUS_OPTIONS}
                      />
                      <RegistryTextField
                        label="Sage job number"
                        name="sageJobNumber"
                        value={selectedRegistryProject.sageJobNumber}
                        placeholder="722"
                      />
                      <RegistryTextField
                        label="Sage internal ID"
                        name="sageJobId"
                        value={selectedRegistryProject.sageJobId}
                      />
                      <RegistryTextField
                        label="Google Drive folder ID"
                        name="googleDriveFolderId"
                        value={selectedRegistryProject.googleDriveFolderId}
                      />
                      <RegistryTextField
                        label="Buildertrend project ID"
                        name="buildertrendProjectId"
                        value={selectedRegistryProject.buildertrendProjectId}
                      />
                      <RegistryTextField
                        label="Schedule sheet ID"
                        name="googleScheduleSheetId"
                        value={selectedRegistryProject.googleScheduleSheetId}
                      />
                      <RegistryTextField
                        label="Daily log sheet ID"
                        name="googleDailyLogSheetId"
                        value={selectedRegistryProject.googleDailyLogSheetId}
                      />
                      <RegistryTextField
                        label="Google calendar ID"
                        name="googleCalendarId"
                        value={selectedRegistryProject.googleCalendarId}
                      />
                      <RegistryTextField
                        label="Telegram intake chat ID"
                        name="telegramChatId"
                        value={selectedRegistryProject.telegramChatId}
                      />
                      <RegistrySelectField
                        label="Owner update channel"
                        name="ownerUpdateChannel"
                        value={selectedRegistryProject.ownerUpdateChannel}
                        options={[
                          { value: "compass", label: "Compass" },
                          { value: "telegram", label: "Telegram" },
                          { value: "email", label: "Email" },
                        ]}
                      />
                      <RegistrySelectField
                        label="Owner update cadence"
                        name="ownerUpdateCadence"
                        value={selectedRegistryProject.ownerUpdateCadence}
                        options={[
                          { value: "weekly", label: "Weekly" },
                          { value: "daily", label: "Daily" },
                          { value: "milestone", label: "Milestone" },
                        ]}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          name="ownerUpdatesEnabled"
                          defaultChecked={
                            selectedRegistryProject.ownerUpdatesEnabled
                          }
                          className="size-4 rounded border-input"
                        />
                        Owner updates enabled
                      </label>
                      <div className="flex items-center gap-3">
                        {registryMessage && (
                          <p className="text-sm text-muted-foreground">
                            {registryMessage}
                          </p>
                        )}
                        <Button type="submit" disabled={isSavingRegistry}>
                          {isSavingRegistry ? "Saving..." : "Save Registry"}
                        </Button>
                      </div>
                    </div>
                  </form>
                )}
              </div>
            </div>
            )}
          </section>
        )}

        {selectedDepartmentGroup && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => selectDepartment("ALL")}
          >
            <IconArrowLeft className="size-4" />
            Department overview
          </Button>
        )}

        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <IconFolder className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">No projects yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No projects match this view yet.
            </p>
          </div>
        ) : selectedDepartmentGroup ? (
          <DepartmentLanding
            group={selectedDepartmentGroup}
            canUpdateStatus={canCreateOrUpdateProjects}
            canOpenTools={canCreateOrUpdateProjects}
            onOpenProjectManager={openProjectManager}
          />
        ) : normalizedQuery && visibleGroups.length > 0 ? (
          <section className="grid gap-4">
            <div className="clarity-section-header flex items-center gap-2 px-4 py-3">
              <IconSearch className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Search results</h2>
            </div>
            {visibleGroups.map((group) => (
              <DepartmentLane
                key={group.id}
                group={group}
                activeDepartment={activeDepartment}
                canUpdateStatus={canCreateOrUpdateProjects}
              />
            ))}
          </section>
        ) : activeDepartment === "ALL" ? (
          <div className="rounded-lg border border-dashed bg-muted/10 p-8 text-center">
            <IconSparkles className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">Choose a department to start.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The logo cards above open the department work hubs.
            </p>
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
