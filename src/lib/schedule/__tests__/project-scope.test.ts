import { describe, expect, it } from "vitest"

import {
  projectScheduleColor,
  projectScheduleLabel,
  schedulePortfolioProjects,
  scheduleProjectSelection,
  scheduleScopeHref,
  scheduleSelectionModeFor,
  scheduleScopeForSelection,
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

  it("replaces the selection in single mode", () => {
    expect(scheduleProjectSelection("single", [projects[0].id], projects[1].id)).toEqual([
      projects[1].id,
    ])
  })

  it("toggles projects and allows an empty selection in multiple mode", () => {
    expect(scheduleProjectSelection("multiple", [projects[0].id], projects[1].id)).toEqual([
      projects[0].id,
      projects[1].id,
    ])
    expect(scheduleProjectSelection("multiple", projects.map((project) => project.id), projects[0].id)).toEqual([
      projects[1].id,
    ])
    expect(scheduleProjectSelection("multiple", [projects[0].id], projects[0].id)).toEqual([])
  })

  it("derives and preserves explicit selection modes", () => {
    expect(scheduleSelectionModeFor(undefined, "project")).toBe("single")
    expect(scheduleSelectionModeFor(undefined, "selected")).toBe("multiple")
    expect(scheduleSelectionModeFor("multiple", "project")).toBe("multiple")
    expect(scheduleSelectionModeFor("invalid", "project")).toBe("single")
    expect(
      scheduleScopeForSelection("multiple", [projects[0].id])
    ).toEqual({
      kind: "selected",
      projectIds: [projects[0].id],
      department: null,
    })
    expect(scheduleScopeForSelection("multiple", [])).toEqual({
      kind: "selected",
      projectIds: [],
      department: null,
    })
    expect(
      scheduleScopeLabel(
        { kind: "selected", projectIds: [projects[0].id], department: null },
        projects
      )
    ).toBe("1 selected project")
    expect(
      scheduleScopeLabel(
        { kind: "selected", projectIds: [], department: null },
        projects
      )
    ).toBe("No projects selected")
  })

  it("keeps schedule query state while changing the selection mode", () => {
    const href = scheduleScopeHref(
      new URLSearchParams("mode=projects&view=list&q=roofing"),
      { scope: "selected", projectIds: [projects[0].id] },
      "multiple"
    )

    expect(href).toBe(
      "/dashboard/schedule?mode=projects&view=list&q=roofing&selection=multiple&scope=selected&projects=proj-o-202-loeffler"
    )
  })
})
