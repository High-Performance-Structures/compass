import type { ProjectDepartment } from "@/lib/project-branding"
import { projectJobStatusBucket } from "@/lib/project-profile"

const PROJECT_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#c2410c",
  "#4f46e5",
  "#0f766e",
  "#be185d",
  "#65a30d",
  "#475569",
] as const

export type ScheduleScopeKind =
  | "project"
  | "selected"
  | "department"
  | "all"

export type ScheduleProjectData = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly department: ProjectDepartment
  readonly color: string
}

type SchedulePortfolioProject = {
  readonly jobStatusId: string
  readonly jobStatusLabel: string
}

export function schedulePortfolioProjects<
  Project extends SchedulePortfolioProject,
>(projects: readonly Project[]): Project[] {
  return projects.filter((project) => {
    const status = projectJobStatusBucket(project)
    return status === "active" || status === "warranty"
  })
}

export type ScheduleScope =
  | {
      readonly kind: "project"
      readonly projectIds: readonly [string]
      readonly department: null
    }
  | {
      readonly kind: "selected"
      readonly projectIds: readonly string[]
      readonly department: null
    }
  | {
      readonly kind: "department"
      readonly projectIds: readonly string[]
      readonly department: ProjectDepartment
    }
  | {
      readonly kind: "all"
      readonly projectIds: readonly string[]
      readonly department: null
    }

function stableHash(value: string): number {
  let hash = 0
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return hash
}

export function projectScheduleColor(projectId: string): string {
  return PROJECT_COLORS[stableHash(projectId) % PROJECT_COLORS.length]
}

export function projectScheduleLabel(
  project: Pick<ScheduleProjectData, "name" | "projectNumber">
): string {
  return project.projectNumber
    ? `${project.projectNumber} — ${project.name}`
    : project.name
}

export function scheduleScopeLabel(
  scope: ScheduleScope,
  projects: readonly ScheduleProjectData[]
): string {
  switch (scope.kind) {
    case "project": {
      const project = projects.find(
        (candidate) => candidate.id === scope.projectIds[0]
      )
      return project ? projectScheduleLabel(project) : "Project schedule"
    }
    case "selected":
      return `${scope.projectIds.length} selected projects`
    case "department":
      return `${scope.department} department`
    case "all":
      return "All projects"
  }
}
