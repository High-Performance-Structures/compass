import { describe, expect, it } from "vitest"

import {
  projectScheduleColor,
  projectScheduleLabel,
  schedulePortfolioProjects,
  scheduleScopeLabel,
  type ScheduleProjectData,
} from "@/lib/schedule/project-scope"

const projects: readonly ScheduleProjectData[] = [
  {
    id: "proj-o-202-loeffler",
    name: "Twinkle Rd Loeffler Residence",
    projectNumber: "O-202-595",
    department: "O",
    color: projectScheduleColor("proj-o-202-loeffler"),
  },
  {
    id: "proj-o-170-loomis",
    name: "County Ln 7 Loomis",
    projectNumber: "O-170-2684",
    department: "O",
    color: projectScheduleColor("proj-o-170-loomis"),
  },
]

describe("unified schedule project scope", () => {
  it("limits the schedule portfolio to active and warranty projects", () => {
    const portfolio = schedulePortfolioProjects([
      { id: "active", jobStatusId: "current", jobStatusLabel: "Current" },
      {
        id: "warranty",
        jobStatusId: "custom-warranty",
        jobStatusLabel: "Under Warranty",
      },
      { id: "complete", jobStatusId: "complete", jobStatusLabel: "Complete" },
      { id: "inactive", jobStatusId: "inactive", jobStatusLabel: "Inactive" },
      { id: "archived", jobStatusId: "archived", jobStatusLabel: "Archived" },
    ])

    expect(portfolio.map((project) => project.id)).toEqual([
      "active",
      "warranty",
    ])
  })

  it("assigns a stable project color", () => {
    expect(projectScheduleColor(projects[0].id)).toBe(
      projectScheduleColor(projects[0].id)
    )
    expect(projectScheduleColor(projects[0].id)).toMatch(/^#[0-9a-f]{6}$/)
  })

  it("uses project numbers in compact schedule labels", () => {
    expect(projectScheduleLabel(projects[0])).toBe(
      "O-202-595 — Twinkle Rd Loeffler Residence"
    )
  })

  it("describes every supported scope", () => {
    expect(
      scheduleScopeLabel(
        {
          kind: "project",
          projectIds: [projects[0].id],
          department: null,
        },
        projects
      )
    ).toContain("O-202-595")
    expect(
      scheduleScopeLabel(
        {
          kind: "selected",
          projectIds: projects.map((project) => project.id),
          department: null,
        },
        projects
      )
    ).toBe("2 selected projects")
    expect(
      scheduleScopeLabel(
        {
          kind: "department",
          projectIds: projects.map((project) => project.id),
          department: "O",
        },
        projects
      )
    ).toBe("O department")
    expect(
      scheduleScopeLabel(
        {
          kind: "all",
          projectIds: projects.map((project) => project.id),
          department: null,
        },
        projects
      )
    ).toBe("All projects")
  })
})
