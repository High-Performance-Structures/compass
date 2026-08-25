import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({
  getDb: vi.fn(),
}))
vi.mock("@/db/schema", () => ({
  feedback: Object.create(null),
}))
vi.mock("@/lib/jarvis/feedback-confirmation", () => ({
  confirmedFeedbackReportFromPayload: vi.fn(),
  feedbackCandidateFromReport: vi.fn(),
}))
vi.mock("@/lib/jarvis/feedback-desk", () => ({
  enqueueFeedbackDeskItem: vi.fn(),
}))
vi.mock("@/lib/jarvis/feedback-github", () => ({
  linkFeedbackDeskItemToGithub: vi.fn(),
}))
vi.mock("@/lib/jarvis/feedback-github-sync", () => ({
  syncFeedbackDeskItemsFromGithub: vi.fn(),
}))
vi.mock("@/lib/jarvis/feedback-delivery", () => ({
  feedbackDeliveryGraphEvent: vi.fn(),
}))
vi.mock("@/lib/jarvis/auth", () => ({
  getJarvisEnvValue: vi.fn(),
}))

import { reconcileStaleFeatureGithubIssueApprovals } from "@/lib/jarvis/feedback-maintenance"

describe("Feedback Desk approval reconciliation", () => {
  it("clears only stale issue approvals through the maintenance write", async () => {
    const updateChain = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn(),
    }
    updateChain.set.mockReturnValue(updateChain)
    updateChain.where.mockReturnValue(updateChain)
    updateChain.returning.mockResolvedValue([{ id: "feature-1" }])
    const db = Object.assign(Object.create(null), {
      update: vi.fn().mockReturnValue(updateChain),
    })

    const result = await reconcileStaleFeatureGithubIssueApprovals(db, "org-1")

    expect(result).toBe(1)
    expect(updateChain.set).toHaveBeenCalledWith({
      githubIssueCreationApprovedAt: null,
      githubIssueCreationApprovedBy: null,
      updatedAt: expect.any(String),
    })
  })
})
