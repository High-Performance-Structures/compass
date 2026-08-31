import { describe, expect, it } from "vitest"

import {
  projectAudienceActiveProjectCookieName,
  resolveProjectAudienceActiveProject,
} from "@/lib/project-audience-active-project"

const projects = [{ id: "project-a" }, { id: "project-b" }]

describe("project audience active project", () => {
  it("keeps owner and partner preferences separate", () => {
    expect(projectAudienceActiveProjectCookieName("owner")).toBe(
      "compass_audience_active_project_owner"
    )
    expect(projectAudienceActiveProjectCookieName("sub-vendor")).toBe(
      "compass_audience_active_project_sub_vendor"
    )
  })

  it("uses the remembered project when it remains accessible", () => {
    expect(resolveProjectAudienceActiveProject(projects, "project-b")).toBe(
      "project-b"
    )
  })

  it("falls back safely when the remembered project is not accessible", () => {
    expect(resolveProjectAudienceActiveProject(projects, "project-c")).toBe(
      "project-a"
    )
    expect(resolveProjectAudienceActiveProject([], "project-c")).toBeNull()
  })
})
