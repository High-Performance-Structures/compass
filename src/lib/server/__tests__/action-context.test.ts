import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCloudflareContext: vi.fn(),
  canFeature: vi.fn(),
  getProjectAccessRecord: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/lib/permission-enforcement", () => ({ canFeature: mocks.canFeature }))
vi.mock("@/lib/project-access", () => ({ getProjectAccessRecord: mocks.getProjectAccessRecord }))
const fakeDb = vi.hoisted(() => {
  const state: { orgProject: unknown } = { orgProject: undefined }
  const query = {
    select: () => query,
    from: () => query,
    where: () => query,
    limit: () => query,
    get: async () => state.orgProject,
  }
  return { state, db: { fake: "db", ...query } }
})
vi.mock("@/db", () => ({ getDb: () => fakeDb.db }))

import type { AuthUser } from "@/lib/auth"
import { DEMO_ORG_ID, DEMO_USER_ID } from "@/lib/demo"
import { orgContext, projectContext } from "@/lib/server/action-context"

const staff: AuthUser = {
  id: "user-1",
  email: "staff@example.test",
  firstName: null,
  lastName: null,
  displayName: "Staff",
  avatarUrl: null,
  role: "office",
  googleEmail: null,
  isActive: true,
  lastLoginAt: null,
  organizationId: "org-1",
  organizationName: "Example",
  organizationType: "internal",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

describe("orgContext", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUser.mockResolvedValue(staff)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.canFeature.mockResolvedValue(true)
  })

  it("returns the user, organization, and database", async () => {
    const result = await orgContext()
    expect(result).toMatchObject({ success: true, data: { user: staff, organizationId: "org-1", db: fakeDb.db } })
  })

  it("fails closed when signed out, without an organization, or without storage", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)
    expect(await orgContext()).toEqual({ success: false, error: "Unauthorized" })
    mocks.getCurrentUser.mockResolvedValueOnce({ ...staff, organizationId: null })
    expect(await orgContext()).toEqual({ success: false, error: "No active organization" })
    mocks.getCloudflareContext.mockResolvedValueOnce({ env: {} })
    expect(await orgContext()).toEqual({ success: false, error: "Database not available" })
  })

  it("refuses writes for the demo account and company, but allows reads", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...staff, id: DEMO_USER_ID })
    expect(await orgContext({ mutation: true })).toEqual({ success: false, error: "DEMO_READ_ONLY" })
    mocks.getCurrentUser.mockResolvedValue({ ...staff, organizationId: DEMO_ORG_ID })
    expect(await orgContext({ mutation: true })).toEqual({ success: false, error: "DEMO_READ_ONLY" })
    expect((await orgContext()).success).toBe(true)
  })

  it("checks the feature permission, defaulting to read or update", async () => {
    mocks.canFeature.mockResolvedValue(false)
    expect(await orgContext({ feature: "project-photos", mutation: true })).toEqual({
      success: false,
      error: "Permission denied: office cannot update project-photos",
    })
    expect(mocks.canFeature).toHaveBeenLastCalledWith(staff, "project-photos", "update")
    await orgContext({ feature: "project-photos" })
    expect(mocks.canFeature).toHaveBeenLastCalledWith(staff, "project-photos", "read")
    await orgContext({ feature: "project-photos", action: "delete", mutation: true })
    expect(mocks.canFeature).toHaveBeenLastCalledWith(staff, "project-photos", "delete")
  })
})

describe("projectContext", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUser.mockResolvedValue(staff)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.canFeature.mockResolvedValue(true)
  })

  it("member scope uses the shared project access rules", async () => {
    const project = { id: "p-1", organizationId: "org-2", projectNumber: "O-1" }
    mocks.getProjectAccessRecord.mockResolvedValue(project)
    const result = await projectContext("p-1", { scope: "member", feature: "schedule" })
    expect(result).toMatchObject({ success: true, data: { project } })
    expect(mocks.getProjectAccessRecord).toHaveBeenCalledWith(fakeDb.db, staff, "p-1")
  })

  it("organization scope only finds projects in the active organization", async () => {
    const project = { id: "p-1", organizationId: "org-1", projectNumber: "O-1" }
    fakeDb.state.orgProject = project
    expect(await projectContext("p-1", { scope: "organization" })).toMatchObject({ success: true, data: { project } })
    expect(mocks.getProjectAccessRecord).not.toHaveBeenCalled()
    fakeDb.state.orgProject = undefined
    expect(await projectContext("p-1", { scope: "organization" })).toEqual({ success: false, error: "Project not found" })
  })

  it("member scope keeps access for project members with no active organization", async () => {
    const project = { id: "p-1", organizationId: "org-2", projectNumber: "O-1" }
    mocks.getCurrentUser.mockResolvedValue({ ...staff, role: "client", organizationId: null, organizationType: null })
    mocks.getProjectAccessRecord.mockResolvedValue(project)
    expect(await projectContext("p-1", { scope: "member" })).toMatchObject({
      success: true,
      data: { organizationId: null, project },
    })
    expect(await projectContext("p-1", { scope: "organization" })).toEqual({ success: false, error: "No active organization" })
  })

  it("reports an inaccessible project as not found", async () => {
    mocks.getProjectAccessRecord.mockResolvedValue(null)
    expect(await projectContext("p-2", { scope: "member" })).toEqual({ success: false, error: "Project not found" })
  })

  it("does not look up the project when the context itself fails", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    await projectContext("p-1", { scope: "member" })
    expect(mocks.getProjectAccessRecord).not.toHaveBeenCalled()
  })
})
