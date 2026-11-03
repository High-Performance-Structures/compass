import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  canFeature: vi.fn(),
  profileOrgContext: vi.fn(),
}))

vi.mock("@/lib/permission-enforcement", () => ({ canFeature: mocks.canFeature }))
vi.mock("@/lib/domain/project/profile-access", () => ({
  profileOrgContext: mocks.profileOrgContext,
  projectProfileContext: vi.fn(),
}))
vi.mock("@/lib/domain/project-audit/store", () => ({ recordProjectAudit: vi.fn() }))
vi.mock("@/lib/domain/project/store", () => ({ insertProjectJobStatus: vi.fn(), updateProjectsStatement: vi.fn() }))
vi.mock("@/lib/domain/crm/store", () => ({ deleteProjectFollowUps: vi.fn(), upsertProjectFollowUp: vi.fn() }))
vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: vi.fn() }))

import { loadProjectFollowUpQueue } from "@/lib/domain/crm/follow-ups"
import { addCustomProjectJobStatus } from "@/lib/domain/project/job-status"

const admin = { id: "u1", role: "admin", organizationId: "org", organizationType: "internal", isActive: true }

describe("Project Hub permission", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // A db that fails loudly if the denied paths ever reach a query.
    mocks.profileOrgContext.mockResolvedValue({
      db: new Proxy({}, { get: () => { throw new Error("db must not be used when permission is denied") } }),
      organizationId: "org",
      user: admin,
    })
  })

  it("hides the follow-up queue when Project Hub read is denied", async () => {
    mocks.canFeature.mockResolvedValue(false)
    await expect(loadProjectFollowUpQueue()).resolves.toEqual([])
    expect(mocks.canFeature).toHaveBeenCalledWith(admin, "project-hub", "read")
  })

  it("refuses a custom job status when Project Hub update is denied", async () => {
    mocks.canFeature.mockResolvedValue(false)
    await expect(
      addCustomProjectJobStatus({ label: "Waiting on permit", sageCode: null, followUpCadenceDays: null })
    ).resolves.toEqual({ success: false, error: "Permission denied: admin cannot update project-hub" })
    expect(mocks.canFeature).toHaveBeenCalledWith(admin, "project-hub", "update")
  })
})
