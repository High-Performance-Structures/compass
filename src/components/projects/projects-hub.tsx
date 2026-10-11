"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { SearchableComboboxField } from "@/components/searchable-combobox"
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
  type ProjectStatusValue,
} from "@/app/actions/projects"
import { updateProjectRegistry } from "@/app/actions/project-registry"
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
import { useDeveloperMode } from "@/components/developer-mode-provider"
import {
  PROJECT_JOB_STATUS_DEFINITIONS,
  projectClientStatusLabel,
  projectJobStatusBucket,
  type ProjectJobStatusBucket,
} from "@/lib/project-profile"
import {
  SAGE_CLIENT_STATUS_OPTIONS,
  SAGE_JOB_TYPE_OPTIONS,
} from "@/lib/sage/client-project-write"
import type { ProjectDepartment } from "@/lib/project-branding"
import { DEPARTMENT_CODES, departmentLogoSrc, type DepartmentProfiles } from "@/lib/department-profiles"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { PageHeader } from "@/components/page-header"
import {
  ProjectBulkStatusBar,
  ProjectSelectCheckbox,
  ProjectSelectionProvider,
  ProjectSelectionToggle,
  useProjectSelected,
} from "@/components/projects/project-bulk-selection"

type DepartmentId = "O" | "H" | "N" | "D" | "UNASSIGNED"
type ProjectStatusBucket = ProjectJobStatusBucket

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
  readonly kind: "link"
  readonly href: string | null
}

type StatusFilterConfig = {
  readonly id: ProjectStatusBucket
  readonly label: string
  readonly description: string
}

const DEPARTMENT_LOOK: Readonly<Record<ProjectDepartment, { readonly accentClassName: string; readonly icon: React.ReactNode }>> = {
  O: { accentClassName: "border-brand-orc-brown bg-brand-orc-brown text-white", icon: <IconHome className="size-4" /> },
  H: { accentClassName: "border-brand-hps-primary bg-brand-hps-primary text-white", icon: <IconBuildingCommunity className="size-4" /> },
  N: { accentClassName: "border-brand-nutech-gold bg-brand-nutech-gold text-white", icon: <IconTool className="size-4" /> },
  D: { accentClassName: "border-brand-orc-brown bg-brand-orc-brown text-white", icon: <IconPaint className="size-4" /> },
}

/** Department tiles from the company's department profiles (names, descriptions, logos). */
function departmentConfigs(profiles: DepartmentProfiles): readonly DepartmentConfig[] {
  return [
    ...DEPARTMENT_CODES.map((code): DepartmentConfig => ({
      id: code,
      label: `${profiles[code].shortName} Projects`,
      shortLabel: profiles[code].shortName,
      description: profiles[code].description,
      logoSrc: departmentLogoSrc(code, profiles[code]),
      ...DEPARTMENT_LOOK[code],
    })),
    {
      id: "UNASSIGNED",
      label: "Unassigned",
      shortLabel: "Other",
      description: "Projects that still need a department project number.",
      accentClassName: "border-muted-foreground/25 bg-muted text-muted-foreground",
      logoSrc: null,
      icon: <IconFolder className="size-4" />,
    },
  ]
}

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



const DEPARTMENT_TOOLS: readonly (DepartmentTool & {
  readonly departments: readonly DepartmentId[]
})[] = [
  {
    departments: ["O", "H", "D"],
    label: "New project",
    description: "Project number, Drive folder from the department template, and Sage review.",
    kind: "link",
    href: "/dashboard/projects",
  },
  {
    departments: ["N"],
    label: "Nu-Tech Order Process",
    description: "Block sales, bracing rentals, pricing, and Airlite orders.",
    kind: "link",
    href: "/dashboard/nutech",
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

function statusBucket(project: ProjectsHubProject): ProjectStatusBucket {
  return projectJobStatusBucket({
    jobStatusId: project.jobStatusId,
    jobStatusLabel: project.jobStatusLabel,
  })
}

function projectStatusValue(status: string): ProjectStatusValue {
  const normalized = status.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")
  const option = PROJECT_STATUS_OPTIONS.find((item) => item.value === normalized)
  if (option) return option.value

  const normalizedStatus = status.trim().toLowerCase()
  const bucket = normalizedStatus === "warranty"
    ? "warranty"
    : normalizedStatus === "complete"
      ? "complete"
      : normalizedStatus === "inactive"
        ? "inactive"
        : normalizedStatus === "archive"
          ? "archive"
          : normalizedStatus === "other"
            ? "other"
            : "active"
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
      return "border-l-brand-orc-brown"
    case "H":
      return "border-l-brand-hps-primary"
    case "N":
      return "border-l-brand-nutech-gold"
    case "D":
      return "border-l-brand-orc-brown"
    case "UNASSIGNED":
      return "border-l-muted-foreground"
  }
}

function departmentHeaderClassName(departmentId: DepartmentId): string {
  switch (departmentId) {
    case "O":
      return "border-brand-orc-brown/60 bg-card"
    case "H":
      return "border-brand-hps-primary/60 bg-card"
    case "N":
      return "border-brand-nutech-gold/60 bg-card"
    case "D":
      return "border-brand-orc-brown/60 bg-card"
    case "UNASSIGNED":
      return "border-muted bg-muted/30"
  }
}

function departmentRingClassName(departmentId: DepartmentId): string {
  switch (departmentId) {
    case "O":
      return "ring-brand-orc-brown/35"
    case "H":
      return "ring-brand-hps-primary/35"
    case "N":
      return "ring-brand-nutech-gold/35"
    case "D":
      return "ring-brand-orc-brown/35"
    case "UNASSIGNED":
      return "ring-muted-foreground/25"
  }
}

function departmentSurfaceClassName(departmentId: DepartmentId): string {
  switch (departmentId) {
    case "O":
      return "border-brand-orc-brown/40 bg-brand-orc-brown/10 hover:bg-brand-orc-brown/15"
    case "H":
      return "border-brand-hps-primary/40 bg-brand-hps-primary/10 hover:bg-brand-hps-primary/15"
    case "N":
      return "border-brand-nutech-gold/40 bg-brand-nutech-gold/10 hover:bg-brand-nutech-gold/15"
    case "D":
      return "border-brand-orc-brown/40 bg-brand-orc-brown/10 hover:bg-brand-orc-brown/15"
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
  return projects.filter((project) => statusBucket(project) === bucket)
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
      projectClientStatusLabel(project.clientStatus),
      project.clientStatus,
      project.jobStatusId,
      project.jobStatusLabel,
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
      <Select name={name} defaultValue={value}>
        <SelectTrigger className="w-full bg-background font-normal text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function ProjectCard({
  project,
}: {
  readonly project: ProjectsHubProject
}): React.ReactElement {
  const label = projectLabel(project)
  const subtitle = projectSubtitle(project)
  const departmentId = departmentIdForProject(project)
  const selected = useProjectSelected(project.id)
  const actionClassName =
    "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"

  return (
    <article
      className={cn(
        "group rounded-md border border-l-[6px] bg-card px-3 py-2.5 shadow-sm transition-colors hover:bg-muted/55",
        departmentBorderClassName(departmentId),
        selected && "ring-2 ring-primary/60"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2">
        <ProjectSelectCheckbox projectId={project.id} label={label} />
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
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {project.jobStatusLabel}
          </span>
          <span className="rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {projectClientStatusLabel(project.clientStatus)}
          </span>
        </div>
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
}: {
  readonly group: DepartmentGroup
  readonly activeDepartment: DepartmentId | "ALL"
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
          <ProjectSelectionToggle visibleProjectIds={visibleProjects.map((project) => project.id)} />
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
            <ProjectCard key={project.id} project={project} />
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
}: {
  readonly tool: DepartmentTool
}): React.ReactElement {
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
  canOpenTools,
}: {
  readonly group: DepartmentGroup
  readonly canOpenTools: boolean
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
                <DepartmentToolButton key={tool.label} tool={tool} />
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
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted-foreground">
              {group.projects.length} shown from {group.allProjects.length} total.
            </p>
            <ProjectSelectionToggle visibleProjectIds={group.projects.map((project) => project.id)} />
          </div>
        </div>
        {group.projects.length > 0 ? (
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {group.projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
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

export function ProjectsHub({
  projects,
  canCreateOrUpdateProjects,
}: {
  readonly projects: readonly ProjectsHubProject[]
  readonly canCreateOrUpdateProjects: boolean
}): React.ReactElement {
  const departmentProfiles = useDepartmentProfiles()
  const departments = React.useMemo(() => departmentConfigs(departmentProfiles), [departmentProfiles])
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
  const [shellDuplicateConfirmation, setShellDuplicateConfirmation] =
    React.useState<{
      readonly draftKey: string
      readonly projectIds: readonly string[]
    } | null>(null)
  const [registryMessage, setRegistryMessage] = React.useState<string | null>(
    null
  )
  const { developerModeEnabled } = useDeveloperMode()
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
    const sageClientStatus = SAGE_CLIENT_STATUS_OPTIONS.find(
      (option) => String(option.id) === String(formData.get("sageClientStatusId") ?? "")
    )
    const sageJobStatusId = String(formData.get("sageJobStatusId") ?? "").trim()
    const sageJobType = SAGE_JOB_TYPE_OPTIONS.find(
      (option) => option.id === String(formData.get("sageJobType") ?? "")
    )

    if (!sageClientStatus || !sageJobStatusId || !sageJobType) {
      setCreateProjectMessage(
        "Choose the Sage client status, job status, and job type."
      )
      return
    }

    const draftKey = JSON.stringify({
      name,
      clientName,
      address,
      department: newProjectDepartment,
      sageClientStatusId: sageClientStatus.id,
      sageJobStatusId,
      sageJobType: sageJobType.id,
    })

    setCreateProjectMessage(null)
    startCreateProjectTransition(async () => {
      const result = await createProjectShell({
        projectNumber: null,
        name,
        department: newProjectDepartment,
        clientName: clientName.length > 0 ? clientName : null,
        address: address.length > 0 ? address : null,
        status: "OPEN",
        sageClientStatusId: sageClientStatus.id,
        sageJobStatusId,
        sageJobType: sageJobType.id,
        confirmedDistinctProjectIds:
          shellDuplicateConfirmation?.draftKey === draftKey
            ? shellDuplicateConfirmation.projectIds
            : [],
      })

      if (!result.success) {
        if ("duplicateWarning" in result) {
          const projectIds = result.candidates.map((candidate) =>
            candidate.second.id,
          )
          setShellDuplicateConfirmation({ draftKey, projectIds })
          setCreateProjectMessage(
            `Possible duplicate found: ${result.candidates
              .map((candidate) => {
                const project = candidate.second
                return project.projectNumber ?? project.name
              })
              .join(", ")}. Submit Create Shell again to confirm this is a separate project.`,
          )
          return
        }
        setCreateProjectMessage(result.error)
        return
      }

      form.reset()
      setShellDuplicateConfirmation(null)
      setCreateProjectMessage("Project shell created; Sage write queued.")
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
  const showRegistryTools = canCreateOrUpdateProjects && developerModeEnabled
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
    activeStatusFilters.includes(statusBucket(project))
  )
  const searchedProjects = statusFilteredProjects.filter((project) =>
    projectMatchesSearch(project, normalizedQuery)
  )
  const groups: readonly DepartmentGroup[] = departments.map((department) => ({
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
    (project) => statusBucket(project) === "active"
  )
  const warrantyProjects = projects.filter(
    (project) => statusBucket(project) === "warranty"
  )
  const completeProjects = projects.filter(
    (project) => statusBucket(project) === "complete"
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

  return (
    <ProjectSelectionProvider enabled={canCreateOrUpdateProjects}>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b bg-background">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 md:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <PageHeader
            className="mb-0 min-w-0"
            icon={<IconCompass className="size-5 text-primary" />}
            title="Project hub"
          />

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
                  : "Search by project number, client, job status, address, or accounting job..."
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
                projects.filter((project) => statusBucket(project) === "other")
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
                  New projects start from the Projects page: Compass assigns the
                  department number, creates the Drive folder from the
                  department template, and stages Sage review.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="default" asChild>
                  <Link href="/dashboard/projects">
                    <IconPlus className="size-4" />
                    New project
                  </Link>
                </Button>
                {showRegistryTools && (
                  <>
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
            {showRegistryTools && (
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              {showCreateProject && (
                <form
                  className="rounded-md border bg-card p-3"
                  onSubmit={createProjectFromForm}
                >
                  <div>
                    <h3 className="text-sm font-semibold">Create new project</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This only creates a Compass shell. Use New project
                      when the job also needs official numbering, a Drive
                      folder, and Sage review.
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {departments.filter((department) => department.id !== "UNASSIGNED").map(
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
                      required
                    />
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-3">
                    <Select name="sageClientStatusId" required>
                      <SelectTrigger aria-label="Sage client status">
                        <SelectValue placeholder="Client status" />
                      </SelectTrigger>
                      <SelectContent>
                        {SAGE_CLIENT_STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={String(option.id)}>
                            {option.id} — {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <SearchableComboboxField
                      name="sageJobStatusId"
                      required
                      options={PROJECT_JOB_STATUS_DEFINITIONS.map((option) => ({
                        value: option.id,
                        label: option.label,
                      }))}
                      ariaLabel="Sage job status"
                      placeholder="Job status"
                      searchPlaceholder="Search job statuses..."
                      emptyMessage="No matching job statuses."
                    />
                    <Select name="sageJobType" required>
                      <SelectTrigger aria-label="Sage job type">
                        <SelectValue placeholder="Job type" />
                      </SelectTrigger>
                      <SelectContent>
                        {SAGE_JOB_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                    Search for a Compass job, then paste or confirm its
                    project number, Drive folder, and accounting IDs.
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
                            {projectSubtitle(project) || project.jobStatusLabel}
                          </span>
                        </button>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            {project.jobStatusLabel}
                          </span>
                          <span className="rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {projectClientStatusLabel(project.clientStatus)}
                          </span>
                        </div>
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
                          and handoff IDs from Compass intake or from
                          Sage/Buildertrend.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
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
                        label="Legacy status"
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
            canOpenTools={canCreateOrUpdateProjects}
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
        <ProjectBulkStatusBar />
      </div>
    </div>
    </ProjectSelectionProvider>
  )
}
