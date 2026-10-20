import { describe, expect, it } from "vitest"
import {
  DEFAULT_PROJECT_HUB_STATUS_FILTER,
  projectMatchesHubTabStatus,
} from "@/lib/project-hub-status-filter"
import { isWorkspaceKind } from "@/lib/internal-duties/model"
import { parseFeatureSettings } from "@/lib/feature-settings/registry"

const office = { jobStatusId: "internal", jobStatusLabel: "Internal", internalDepartment: true }
const crewWorkspace = { jobStatusId: "internal", jobStatusLabel: "Internal", internalDepartment: false }
const clientJob = { jobStatusId: "under_construction", jobStatusLabel: "Under Construction", internalDepartment: false }

describe("Internal department tab", () => {
  it("shows running internal workspaces on the Internal tab under the default Active view", () => {
    expect(projectMatchesHubTabStatus(office, DEFAULT_PROJECT_HUB_STATUS_FILTER, true)).toBe(true)
  })

  it("keeps the other tabs' Active view unchanged", () => {
    expect(projectMatchesHubTabStatus(office, DEFAULT_PROJECT_HUB_STATUS_FILTER, false)).toBe(false)
    expect(projectMatchesHubTabStatus(clientJob, DEFAULT_PROJECT_HUB_STATUS_FILTER, false)).toBe(true)
  })

  it("doesn't pull workspaces that stay with their own department onto the Internal tab", () => {
    expect(projectMatchesHubTabStatus(crewWorkspace, DEFAULT_PROJECT_HUB_STATUS_FILTER, true)).toBe(false)
  })

  it("respects an explicit status choice", () => {
    expect(projectMatchesHubTabStatus(office, { kind: "bucket", bucket: "complete" }, true)).toBe(false)
  })
})

describe("internal workspace settings", () => {
  it("recognizes only the three workspace kinds", () => {
    expect(isWorkspaceKind("office")).toBe(true)
    expect(isWorkspaceKind("executive")).toBe(true)
    expect(isWorkspaceKind("field")).toBe(true)
    expect(isWorkspaceKind("client")).toBe(false)
  })

  it("defaults the department name to Internal and keeps a saved name", () => {
    expect(parseFeatureSettings("internal-department", null).name).toBe("Internal")
    expect(parseFeatureSettings("internal-department", JSON.stringify({ name: "Operations" })).name).toBe("Operations")
  })
})
