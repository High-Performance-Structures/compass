import {
  PROJECT_JOB_STATUS_DEFINITIONS,
  projectJobStatusBucket,
  type ProjectJobStatusBucket,
} from "@/lib/project-profile"

export type ProjectHubStatusProject = {
  readonly jobStatusId: string
  readonly jobStatusLabel: string
}

export type ProjectHubStatusFilter =
  | { readonly kind: "all" }
  | { readonly kind: "bucket"; readonly bucket: ProjectJobStatusBucket }
  | { readonly kind: "job"; readonly jobStatusId: string }

export type ProjectHubStatusFilterOption = {
  readonly key: string
  readonly label: string
  readonly count: number
  readonly group: "views" | "job-statuses"
  readonly filter: ProjectHubStatusFilter
}

const PROJECT_STATUS_BUCKET_OPTIONS: readonly {
  readonly bucket: ProjectJobStatusBucket
  readonly label: string
}[] = [
  { bucket: "active", label: "Active" },
  { bucket: "warranty", label: "Warranty" },
  { bucket: "complete", label: "Complete" },
  { bucket: "inactive", label: "Inactive" },
  { bucket: "archive", label: "Archive" },
  { bucket: "other", label: "Other" },
]

export const DEFAULT_PROJECT_HUB_STATUS_FILTER: ProjectHubStatusFilter = {
  kind: "bucket",
  bucket: "active",
}

export const ALL_PROJECT_HUB_STATUSES_FILTER: ProjectHubStatusFilter = {
  kind: "all",
}

export function projectHubStatusFilterKey(
  filter: ProjectHubStatusFilter,
): string {
  if (filter.kind === "all") return "all"
  if (filter.kind === "bucket") return `bucket:${filter.bucket}`
  return `job:${filter.jobStatusId}`
}

export function projectHubStatusFilterLabel(
  filter: ProjectHubStatusFilter,
): string {
  if (filter.kind === "all") return "All"
  if (filter.kind === "job") {
    return (
      PROJECT_JOB_STATUS_DEFINITIONS.find(
        (status) => status.id === filter.jobStatusId,
      )?.label ?? "Selected status"
    )
  }
  return (
    PROJECT_STATUS_BUCKET_OPTIONS.find(
      (option) => option.bucket === filter.bucket,
    )?.label ?? "Selected view"
  )
}

export function projectMatchesProjectHubStatusFilter(
  project: ProjectHubStatusProject,
  filter: ProjectHubStatusFilter,
): boolean {
  if (filter.kind === "all") return true
  if (filter.kind === "job") return project.jobStatusId === filter.jobStatusId
  return (
    projectJobStatusBucket({
      jobStatusId: project.jobStatusId,
      jobStatusLabel: project.jobStatusLabel,
    }) === filter.bucket
  )
}

export function projectHubStatusFilterOptions(
  projects: readonly ProjectHubStatusProject[],
): readonly ProjectHubStatusFilterOption[] {
  const viewOptions: ProjectHubStatusFilterOption[] = [
    {
      key: projectHubStatusFilterKey(ALL_PROJECT_HUB_STATUSES_FILTER),
      label: "All",
      count: projects.length,
      group: "views",
      filter: ALL_PROJECT_HUB_STATUSES_FILTER,
    },
    ...PROJECT_STATUS_BUCKET_OPTIONS.map(
      (option): ProjectHubStatusFilterOption => {
        const filter: ProjectHubStatusFilter = {
          kind: "bucket",
          bucket: option.bucket,
        }
        return {
          key: projectHubStatusFilterKey(filter),
          label: option.label,
          count: projects.filter((project) =>
            projectMatchesProjectHubStatusFilter(project, filter),
          ).length,
          group: "views",
          filter,
        }
      },
    ),
  ]

  const statusCounts = new Map<
    string,
    { readonly label: string; readonly count: number }
  >()
  for (const project of projects) {
    const current = statusCounts.get(project.jobStatusId)
    statusCounts.set(project.jobStatusId, {
      label: project.jobStatusLabel,
      count: (current?.count ?? 0) + 1,
    })
  }

  const jobStatusOptions: ProjectHubStatusFilterOption[] = []
  // The filter is also a status directory, so approved choices stay visible at zero.
  for (const definition of PROJECT_JOB_STATUS_DEFINITIONS) {
    const status = statusCounts.get(definition.id)
    const filter: ProjectHubStatusFilter = {
      kind: "job",
      jobStatusId: definition.id,
    }
    jobStatusOptions.push({
      key: projectHubStatusFilterKey(filter),
      label: definition.label,
      count: status?.count ?? 0,
      group: "job-statuses",
      filter,
    })
    statusCounts.delete(definition.id)
  }

  const customStatusOptions = Array.from(
    statusCounts,
    ([jobStatusId, status]): ProjectHubStatusFilterOption => {
      const filter: ProjectHubStatusFilter = { kind: "job", jobStatusId }
      return {
        key: projectHubStatusFilterKey(filter),
        label: status.label,
        count: status.count,
        group: "job-statuses",
        filter,
      }
    },
  ).sort((left, right) => left.label.localeCompare(right.label))

  return [...viewOptions, ...jobStatusOptions, ...customStatusOptions]
}
