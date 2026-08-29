import { describe, expect, it } from "vitest"

import type { FieldProject } from "../src/lib/field/types"
import {
  filterFieldProjects,
  isProjectCompanyFilter,
  isReviewSampleWorkspace,
  projectCompanyOptionsForProjects,
  projectCompanyLabel,
} from "./project-picker"

const projects: readonly FieldProject[] = [
  { id: "orc", name: "Loeffler Residence", projectNumber: "O-202-595", address: "595 Twinkle Road" },
  { id: "hps", name: "Shop Addition", projectNumber: "H-104-200", address: "Main Street" },
  { id: "nutech", name: "Vogel Controls", projectNumber: "N-830-8220", address: "Pine Avenue" },
  { id: "design", name: "Café Redesign", projectNumber: "D-18-00", address: null },
]

describe("mobile project picker", () => {
  it("filters projects by each company prefix", () => {
    expect(filterFieldProjects(projects, "O", "")).toEqual([projects[0]])
    expect(filterFieldProjects(projects, "H", "")).toEqual([projects[1]])
    expect(filterFieldProjects(projects, "N", "")).toEqual([projects[2]])
    expect(filterFieldProjects(projects, "D", "")).toEqual([projects[3]])
  })

  it("searches project number, name, address, and company", () => {
    expect(filterFieldProjects(projects, "all", "202 loeffler")).toEqual([projects[0]])
    expect(filterFieldProjects(projects, "all", "pine")).toEqual([projects[2]])
    expect(filterFieldProjects(projects, "all", "nu-tech")).toEqual([projects[2]])
    expect(filterFieldProjects(projects, "all", "cafe")).toEqual([projects[3]])
  })

  it("combines the company filter with search terms", () => {
    expect(filterFieldProjects(projects, "H", "addition")).toEqual([projects[1]])
    expect(filterFieldProjects(projects, "O", "addition")).toEqual([])
  })

  it("provides short labels and validates filter values", () => {
    expect(projectCompanyLabel(projects[0])).toBe("ORC")
    expect(projectCompanyLabel(projects[1])).toBe("HPS")
    expect(projectCompanyLabel(projects[2])).toBe("Nu-Tech")
    expect(projectCompanyLabel(projects[3])).toBe("Design")
    expect(isProjectCompanyFilter("N")).toBe(true)
    expect(isProjectCompanyFilter("other")).toBe(false)
  })

  it("uses neutral department labels for an isolated review workspace", () => {
    const reviewProjects: readonly FieldProject[] = [
      {
        id: "proj-bt-sample-job",
        name: "Compass Review Sample Project",
        projectNumber: "TEST-001",
        address: "100 Example Street",
      },
    ]

    expect(isReviewSampleWorkspace(reviewProjects)).toBe(true)
    expect(projectCompanyLabel(reviewProjects[0], true)).toBe("General")
    expect(projectCompanyOptionsForProjects(reviewProjects)).toEqual([])
    expect(filterFieldProjects(reviewProjects, "all", "General", true)).toEqual(
      reviewProjects
    )
  })

  it("keeps normal department labels when review and real projects are mixed", () => {
    const mixedProjects: readonly FieldProject[] = [
      projects[1],
      {
        id: "proj-bt-sample-job",
        name: "Compass Review Sample Project",
        projectNumber: "TEST-001",
        address: "100 Example Street",
      },
    ]

    expect(isReviewSampleWorkspace(mixedProjects)).toBe(false)
    expect(projectCompanyLabel(mixedProjects[1])).toBe("HPS")
    expect(projectCompanyOptionsForProjects(mixedProjects)).toEqual(
      expect.arrayContaining([{ value: "H", label: "HPS" }])
    )
  })
})
