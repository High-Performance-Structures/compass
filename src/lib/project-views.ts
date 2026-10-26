import { z } from "zod/v4"
import {
  DEFAULT_PROJECT_HUB_STATUS_FILTER,
  projectHubStatusFilterKey,
  projectMatchesHubTabStatus,
  type ProjectHubStatusFilter,
} from "@/lib/project-hub-status-filter"

export type ProjectDepartmentFilter = "ALL" | "O" | "H" | "N" | "D" | "INTERNAL" | "OTHER"
export type ProjectViewDefinition = {
  readonly department: ProjectDepartmentFilter
  readonly status: ProjectHubStatusFilter
}

export const projectViewDefinitionSchema = z.object({
  department: z.enum(["ALL", "O", "H", "N", "D", "INTERNAL", "OTHER"]),
  status: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("all") }),
    z.object({ kind: z.literal("bucket"), bucket: z.enum(["active", "warranty", "complete", "inactive", "internal", "archive", "other"]) }),
    z.object({ kind: z.literal("job"), jobStatusId: z.string().trim().min(1).max(200) }),
  ]),
})

export const DEFAULT_PROJECT_VIEW: ProjectViewDefinition = {
  department: "ALL",
  status: DEFAULT_PROJECT_HUB_STATUS_FILTER,
}

export type SavedProjectView = {
  readonly id: string
  readonly name: string
  readonly visibility: "personal" | "shared"
  readonly isOwner: boolean
  readonly definition: ProjectViewDefinition
}

export type ProjectViewPreferences = {
  readonly defaultDefinition: ProjectViewDefinition | null
  readonly canSave: boolean
  readonly error: string | null
}

export function projectDefaultViewKey(organizationId: string): string {
  return `project-hub-default:${organizationId}`
}

export function parseProjectViewDefinition(value: string): ProjectViewDefinition | null {
  try {
    const raw: unknown = JSON.parse(value)
    const parsed = projectViewDefinitionSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function sameProjectView(left: ProjectViewDefinition, right: ProjectViewDefinition): boolean {
  return left.department === right.department &&
    projectHubStatusFilterKey(left.status) === projectHubStatusFilterKey(right.status)
}

type FilterableProject = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
  readonly clientName: string | null
  readonly jobStatusId: string
  readonly jobStatusLabel: string
  readonly internalDepartment: boolean
}

export function projectDepartment(project: Pick<FilterableProject, "projectNumber" | "internalDepartment">): ProjectDepartmentFilter {
  if (project.internalDepartment) return "INTERNAL"
  const prefix = project.projectNumber?.trim().slice(0, 1).toUpperCase()
  if (prefix === "O" || prefix === "H" || prefix === "N" || prefix === "D") return prefix
  return "OTHER"
}

export function projectMatchesView(project: FilterableProject, definition: ProjectViewDefinition): boolean {
  return (definition.department === "ALL" || projectDepartment(project) === definition.department) &&
    projectMatchesHubTabStatus(project, definition.status, definition.department === "INTERNAL")
}

/** Search deliberately ignores the view, but can only search the authorized input list. */
export function filterProjectView<T extends FilterableProject>(projects: readonly T[], definition: ProjectViewDefinition | null, query: string): readonly T[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (words.length > 0) {
    return projects.filter((project) => {
      const text = [project.projectNumber, project.name, project.clientName, project.jobStatusLabel].filter(Boolean).join(" ").toLocaleLowerCase()
      return words.every((word) => text.includes(word))
    })
  }
  return definition === null ? projects : projects.filter((project) => projectMatchesView(project, definition))
}

/** Keep an authorized active project available when browsing a narrower default. */
export function projectBrowseIds(projects: readonly FilterableProject[], definition: ProjectViewDefinition, activeProjectId: string | null): readonly string[] {
  return projects.filter((project) => project.id === activeProjectId || projectMatchesView(project, definition)).map((project) => project.id)
}
