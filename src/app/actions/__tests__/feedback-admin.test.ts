import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  applyFeedbackLifecycleUpdate: vi.fn(),
  canManageUserAccess: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireAuth: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permissions", () => ({ canManageUserAccess: mocks.canManageUserAccess }))
vi.mock("@/lib/user-roles", () => ({
  isInternalStaffRole: vi.fn(() => true),
}))
vi.mock("@/lib/jarvis/feedback-maintenance", () => ({
  runFeedbackMaintenance: vi.fn(),
}))
vi.mock("@/lib/jarvis/feedback-status-update", () => ({
  applyFeedbackLifecycleUpdate: mocks.applyFeedbackLifecycleUpdate,
}))

import {
  setFeedbackGithubIssueCreationApproval,
  updateFeedbackAdminItem,
} from "@/app/actions/feedback-admin"

const unprovenBug = {
  id: "feedback-1",
  kind: "bug",
  status: "triaged",
  deliveryGraphId: null,
  deliveryGraphStatus: null,
  deliveryGraphImplementationTaskId: null,
  deliveryGraphReviewTaskId: null,
  deliveryGraphReleaseTaskId: null,
  githubDraftPullRequestUrl: null,
}

function configureDb() {
  const chain = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.get.mockResolvedValue(unprovenBug)
  mocks.getDb.mockReturnValue({ select: vi.fn().mockReturnValue(chain) })
}

describe("updateFeedbackAdminItem lifecycle evidence", () => {
  beforeEach(() => {
    configureDb()
    mocks.requireAuth.mockResolvedValue({ id: "admin-1", organizationId: "org-1" })
    mocks.canManageUserAccess.mockReturnValue(true)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.applyFeedbackLifecycleUpdate.mockReset()
  })

  it("fails closed before an administrator can start unproven bug work", async () => {
    const result = await updateFeedbackAdminItem({
      id: "feedback-1",
      status: "in_progress",
      priority: "normal",
      assignedToUserId: null,
    })

    expect(result).toEqual({
      success: false,
      error: "A bug must have a complete durable delivery graph before implementation starts",
    })
    expect(mocks.applyFeedbackLifecycleUpdate).not.toHaveBeenCalled()
  })
})

describe("setFeedbackGithubIssueCreationApproval concurrency gate", () => {
  it("rejects when priority is revoked before the conditional approval write", async () => {
    const selectChain = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    selectChain.get.mockResolvedValue({
      id: "feature-1",
      kind: "feature",
      githubIssueUrl: null,
      featurePriorityApprovedAt: "2026-08-12T00:00:00.000Z",
    })
    const updateChain = { set: vi.fn(), where: vi.fn(), returning: vi.fn() }
    updateChain.set.mockReturnValue(updateChain)
    updateChain.where.mockReturnValue(updateChain)
    updateChain.returning.mockResolvedValue([])
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    })
    mocks.requireAuth.mockResolvedValue({ id: "admin-1", organizationId: "org-1" })
    mocks.canManageUserAccess.mockReturnValue(true)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })

    const result = await setFeedbackGithubIssueCreationApproval({
      id: "feature-1",
      approved: true,
    })

    expect(result).toEqual({
      success: false,
      error: "Approve this feature's priority before approving a new GitHub issue",
    })
  })
})
