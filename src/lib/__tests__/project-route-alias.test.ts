import { describe, expect, it } from "vitest"

import { projectRouteAliasDestination } from "@/lib/project-route-alias"

describe("projectRouteAliasDestination", () => {
  it("lands a merged legacy route on the canonical project information page", () => {
    expect(projectRouteAliasDestination("proj-bt-lead-n-713-00")).toBe(
      "/dashboard/projects/proj-bt-lead-n-713-00/information",
    )
  })

  it("encodes target ids as one route segment", () => {
    expect(projectRouteAliasDestination("project:with/slash")).toBe(
      "/dashboard/projects/project%3Awith%2Fslash/information",
    )
  })
})
