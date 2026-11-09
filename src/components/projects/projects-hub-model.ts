// What the Projects page works with, as plain data and pure functions:
// departments (O, H, N, D, Unassigned), status buckets and filters,
// department quick tools, search matching and department colours.
// No React rendering here, so it is easy to read and test.

import type { ReactNode } from "react"
import type { ProjectsHubProject } from "@/app/dashboard/projects/page"
import type { ProjectStatusValue } from "@/app/actions/projects"
import {
  projectClientStatusLabel,
  projectJobStatusBucket,
  type ProjectJobStatusBucket,
} from "@/lib/project-profile"

export type DepartmentId = "O" | "H" | "N" | "D" | "UNASSIGNED"
export type ProjectStatusBucket = ProjectJobStatusBucket

type ProjectStatusOption = {
  readonly value: ProjectStatusValue
  readonly label: string
  readonly bucket: ProjectStatusBucket
}

export type DepartmentConfig = {
  readonly id: DepartmentId
  readonly label: string
  readonly shortLabel: string
  readonly description: string
  readonly accentClassName: string
  readonly logoSrc: string | null
  readonly icon: ReactNode
}

export type DepartmentGroup = DepartmentConfig & {
  readonly projects: readonly ProjectsHubProject[]
  readonly allProjects: readonly ProjectsHubProject[]
}

export type DepartmentTool = {
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

export const STATUS_FILTERS: readonly StatusFilterConfig[] = [
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

export const PROJECT_STATUS_OPTIONS: readonly ProjectStatusOption[] = [
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

export function normalizeSearchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function departmentIdForProject(project: ProjectsHubProject): DepartmentId {
  const firstCharacter = project.projectNumber?.trim().slice(0, 1).toUpperCase()
  if (firstCharacter === "O") return "O"
  if (firstCharacter === "H") return "H"
  if (firstCharacter === "N") return "N"
  if (firstCharacter === "D") return "D"
  return "UNASSIGNED"
}

export function projectLabel(project: ProjectsHubProject): string {
  return project.projectNumber ?? project.name
}

export function projectSubtitle(project: ProjectsHubProject): string {
  return [project.name, project.clientName, project.address]
    .filter((value): value is string => Boolean(value))
    .join(" · ")
}

export function statusBucket(project: ProjectsHubProject): ProjectStatusBucket {
  return projectJobStatusBucket({
    jobStatusId: project.jobStatusId,
    jobStatusLabel: project.jobStatusLabel,
  })
}

export function projectStatusValue(status: string): ProjectStatusValue {
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

export function statusFilterLabel(statusFilters: readonly ProjectStatusBucket[]): string {
  if (statusFilters.length === STATUS_FILTERS.length) return "all statuses"

  const labels = STATUS_FILTERS.filter((filter) =>
    statusFilters.includes(filter.id)
  ).map((filter) => filter.label.toLowerCase())

  return labels.join(", ")
}

export function googleDriveUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`
}

export function departmentBorderClassName(departmentId: DepartmentId): string {
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

export function departmentHeaderClassName(departmentId: DepartmentId): string {
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

export function departmentRingClassName(departmentId: DepartmentId): string {
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

export function departmentSurfaceClassName(departmentId: DepartmentId): string {
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

export function toolsForDepartment(departmentId: DepartmentId): readonly DepartmentTool[] {
  return DEPARTMENT_TOOLS.filter((tool) =>
    tool.departments.includes(departmentId)
  )
}

export function countByStatusBucket(
  projects: readonly ProjectsHubProject[],
  bucket: ProjectStatusBucket
): number {
  return projects.filter((project) => statusBucket(project) === bucket)
    .length
}

export function projectMatchesSearch(
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
