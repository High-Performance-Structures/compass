import type { FieldProject } from "../src/lib/field/types"
import {
  projectDepartment,
  type ProjectDepartment,
} from "../src/lib/project-branding"

export type ProjectCompanyFilter = "all" | ProjectDepartment

export type ProjectCompanyOption = {
  readonly value: ProjectDepartment
  readonly label: string
}

export const PROJECT_COMPANY_OPTIONS: readonly ProjectCompanyOption[] = [
  { value: "O", label: "ORC" },
  { value: "H", label: "HPS" },
  { value: "N", label: "Nu-Tech" },
  { value: "D", label: "Design" },
]

export function isProjectCompanyFilter(
  value: string
): value is ProjectCompanyFilter {
  return value === "all" || PROJECT_COMPANY_OPTIONS.some((option) => option.value === value)
}

export function projectCompany(project: FieldProject): ProjectDepartment {
  return projectDepartment({
    projectId: project.id,
    projectNumber: project.projectNumber,
  })
}

export function isReviewSampleProject(project: FieldProject): boolean {
  return (
    project.id === "proj-bt-sample-job" ||
    project.projectNumber?.toUpperCase().startsWith("TEST-") === true
  )
}

export function isReviewSampleWorkspace(
  projects: readonly FieldProject[]
): boolean {
  return projects.length > 0 && projects.every(isReviewSampleProject)
}

export function projectCompanyOptionsForProjects(
  projects: readonly FieldProject[]
): readonly ProjectCompanyOption[] {
  if (isReviewSampleWorkspace(projects)) {
    return []
  }
  return PROJECT_COMPANY_OPTIONS
}

export function projectCompanyLabel(
  project: FieldProject,
  neutralReviewWorkspace = false
): string {
  if (neutralReviewWorkspace && isReviewSampleProject(project)) return "General"
  const company = projectCompany(project)
  return PROJECT_COMPANY_OPTIONS.find((option) => option.value === company)?.label ?? "HPS"
}

function normalizedSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim()
}

export function filterFieldProjects(
  projects: readonly FieldProject[],
  companyFilter: ProjectCompanyFilter,
  query: string,
  neutralReviewWorkspace = false
): readonly FieldProject[] {
  const searchTerms = normalizedSearch(query).split(/\s+/).filter(Boolean)

  return projects.filter((project) => {
    if (companyFilter !== "all" && projectCompany(project) !== companyFilter) {
      return false
    }

    if (searchTerms.length === 0) return true

    const searchable = normalizedSearch(
      [
        project.projectNumber ?? "",
        project.name,
        project.address ?? "",
        projectCompanyLabel(project, neutralReviewWorkspace),
      ].join(" ")
    )
    return searchTerms.every((term) => searchable.includes(term))
  })
}
