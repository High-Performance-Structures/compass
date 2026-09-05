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

export type ScheduleSelectionMode = "single" | "multiple"

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

export type ScheduleScopeLink =
  | { readonly scope: "all" }
  | { readonly scope: "department"; readonly department: string }
  | { readonly scope: "selected"; readonly projectIds: readonly string[] }
  | { readonly scope: "project"; readonly projectId: string }

export function scheduleProjectSelection(
  mode: ScheduleSelectionMode,
  selectedProjectIds: readonly string[],
  projectId: string
): readonly string[] {
  if (mode === "single") return [projectId]
  return selectedProjectIds.includes(projectId)
    ? selectedProjectIds.filter((selectedId) => selectedId !== projectId)
    : [...selectedProjectIds, projectId]
}

export function scheduleSelectionModeFor(
  value: string | null | undefined,
  scopeKind: ScheduleScopeKind
): ScheduleSelectionMode {
  if (value === "multiple") return "multiple"
  if (value === "single") return "single"
  return scopeKind === "selected" ? "multiple" : "single"
}

export function scheduleScopeForSelection(
  mode: ScheduleSelectionMode,
  projectIds: readonly string[]
): ScheduleScope {
  if (mode === "single" && projectIds[0]) {
    return {
      kind: "project",
      projectIds: [projectIds[0]],
      department: null,
    }
  }
  return {
    kind: "selected",
    projectIds,
    department: null,
  }
}

export function scheduleScopeHref(
  searchParams: URLSearchParams,
  next: ScheduleScopeLink,
  selectionMode: ScheduleSelectionMode
): string {
  const params = new URLSearchParams(searchParams.toString())
  params.set("mode", "projects")
  params.set("selection", selectionMode)
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
      return scope.projectIds.length === 0
        ? "No projects selected"
        : `${scope.projectIds.length} selected project${
            scope.projectIds.length === 1 ? "" : "s"
          }`
    case "department":
      return `${scope.department} department`
    case "all":
      return "All projects"
  }
}
