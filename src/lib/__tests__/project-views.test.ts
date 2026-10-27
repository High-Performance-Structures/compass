import { describe, expect, it } from "vitest"
import { DEFAULT_PROJECT_VIEW, filterProjectView, parseProjectViewDefinition, projectBrowseIds, projectDefaultViewKey, sameProjectView, type ProjectViewDefinition } from "@/lib/project-views"

const view: ProjectViewDefinition = { department: "H", status: { kind: "job", jobStatusId: "under_construction" } }
const projects = [
  { id: "h", projectNumber: "H-101", name: "Hill House", clientName: "Pat Lee", jobStatusId: "under_construction", jobStatusLabel: "Under Construction", internalDepartment: false },
  { id: "o", projectNumber: "O-202", name: "Orchard House", clientName: "Jo Rivers", jobStatusId: "complete", jobStatusLabel: "Complete", internalDepartment: false },
  { id: "office", projectNumber: "H-OFFICE", name: "Office", clientName: null, jobStatusId: "internal", jobStatusLabel: "Internal", internalDepartment: true },
]

describe("personal project views and broad search", () => {
  it("round trips all status kinds and rejects malformed stored definitions", () => {
    for (const definition of [view, DEFAULT_PROJECT_VIEW, { department: "INTERNAL", status: { kind: "all" } }]) {
      expect(parseProjectViewDefinition(JSON.stringify(definition))).toEqual(definition)
    }
    for (const raw of ["not json", "null", '{"department":"invalid","status":{"kind":"all"}}', '{"department":"ALL","status":{"kind":"job","jobStatusId":""}}', '{"department":"ALL","status":{"kind":"bucket","bucket":"bad"}}']) {
      expect(parseProjectViewDefinition(raw)).toBeNull()
    }
    expect(sameProjectView(view, { ...view })).toBe(true)
    expect(sameProjectView(view, DEFAULT_PROJECT_VIEW)).toBe(false)
  })

  it("browses the default but searches across departments and statuses, then restores filters", () => {
    expect(filterProjectView(projects, view, "").map((p) => p.id)).toEqual(["h"])
    expect(filterProjectView(projects, view, "orchard").map((p) => p.id)).toEqual(["o"])
    expect(filterProjectView(projects, view, "O-202 rivers").map((p) => p.id)).toEqual(["o"])
    expect(filterProjectView(projects, view, "complete").map((p) => p.id)).toEqual(["o"])
    expect(filterProjectView(projects, view, "   ").map((p) => p.id)).toEqual(["h"])
    expect(filterProjectView(projects, view, "missing")).toEqual([])
  })

  it("never searches projects excluded by the access-scoped input", () => {
    expect(filterProjectView(projects.slice(0, 1), view, "orchard")).toEqual([])
    expect(projectBrowseIds(projects.slice(0, 1), view, "o")).toEqual(["h"])
  })

  it("retains an accessible active project in the browse list without broadening the view", () => {
    expect(projectBrowseIds(projects, view, "o")).toEqual(["h", "o"])
    expect(filterProjectView(projects, view, "").map((p) => p.id)).toEqual(["h"])
    expect(projectBrowseIds(projects, { ...view, department: "N" }, null)).toEqual([])
    expect(filterProjectView(projects, { ...view, department: "N" }, "orchard").map((p) => p.id)).toEqual(["o"])
  })

  it("preserves the Internal department's existing Active behavior", () => {
    expect(filterProjectView(projects, { ...DEFAULT_PROJECT_VIEW, department: "INTERNAL" }, "").map((p) => p.id)).toEqual(["office"])
  })

  it("qualifies personal defaults by active organization", () => {
    expect(projectDefaultViewKey("org-a")).not.toBe(projectDefaultViewKey("org-b"))
  })
})
