import { describe, expect, it } from "vitest"

import {
  ALL_PROJECT_HUB_STATUSES_FILTER,
  projectHubStatusFilterLabel,
  projectHubStatusFilterOptions,
  projectMatchesProjectHubStatusFilter,
  type ProjectHubStatusFilter,
  type ProjectHubStatusProject,
} from "@/lib/project-hub-status-filter"

const ESTIMATING_PROJECT: ProjectHubStatusProject = {
  jobStatusId: "estimating",
  jobStatusLabel: "Estimating",
}
const INACTIVE_PROJECT: ProjectHubStatusProject = {
  jobStatusId: "inactive",
  jobStatusLabel: "Inactive",
}

const PROJECTS: readonly ProjectHubStatusProject[] = [
  ESTIMATING_PROJECT,
  { jobStatusId: "estimating", jobStatusLabel: "Estimating" },
  { jobStatusId: "under_construction", jobStatusLabel: "Under Construction" },
  { jobStatusId: "complete", jobStatusLabel: "Complete" },
  INACTIVE_PROJECT,
  { jobStatusId: "custom:coverage", jobStatusLabel: "Coverage Review" },
]

describe("project hub status filters", () => {
  it("offers lifecycle views and every job status represented in the project list", () => {
    const options = projectHubStatusFilterOptions(PROJECTS)

    expect(
      options
        .filter((option) => option.group === "views")
        .map((option) => [option.label, option.count]),
    ).toEqual([
      ["All", 6],
      ["Active", 4],
      ["Warranty", 0],
      ["Complete", 1],
      ["Inactive", 1],
      ["Archive", 0],
      ["Other", 0],
    ])
    expect(
      options
        .filter((option) => option.group === "job-statuses")
        .map((option) => [option.label, option.count]),
    ).toEqual([
      ["Estimating", 2],
      ["Under Construction", 1],
      ["Complete", 1],
      ["Inactive", 1],
      ["Coverage Review", 1],
    ])
  })

  it("matches broad lifecycle views separately from exact job statuses", () => {
    const estimating: ProjectHubStatusFilter = {
      kind: "job",
      jobStatusId: "estimating",
    }
    const inactive: ProjectHubStatusFilter = {
      kind: "bucket",
      bucket: "inactive",
    }

    expect(
      projectMatchesProjectHubStatusFilter(ESTIMATING_PROJECT, estimating),
    ).toBe(true)
    expect(
      projectMatchesProjectHubStatusFilter(ESTIMATING_PROJECT, inactive),
    ).toBe(false)
    expect(
      projectMatchesProjectHubStatusFilter(INACTIVE_PROJECT, inactive),
    ).toBe(true)
    expect(
      PROJECTS.every((project) =>
        projectMatchesProjectHubStatusFilter(
          project,
          ALL_PROJECT_HUB_STATUSES_FILTER,
        ),
      ),
    ).toBe(true)
  })

  it("labels both lifecycle and exact built-in filters", () => {
    expect(
      projectHubStatusFilterLabel({ kind: "bucket", bucket: "archive" }),
    ).toBe("Archive")
    expect(
      projectHubStatusFilterLabel({
        kind: "job",
        jobStatusId: "awaiting_payment",
      }),
    ).toBe("Awaiting Payment")
  })
})
