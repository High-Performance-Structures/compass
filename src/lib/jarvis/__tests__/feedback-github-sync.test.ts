import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  applyFeedbackLifecycleUpdate: vi.fn(),
  getJarvisEnvValue: vi.fn(),
}))

vi.mock("@/lib/jarvis/auth", () => ({
  getJarvisEnvValue: mocks.getJarvisEnvValue,
}))
vi.mock("@/lib/jarvis/feedback-status-update", () => ({
  applyFeedbackLifecycleUpdate: mocks.applyFeedbackLifecycleUpdate,
}))

import { syncFeedbackDeskItemsFromGithub } from "@/lib/jarvis/feedback-github-sync"
import type { FeedbackDeskItem } from "@/db/schema-jarvis"

const item: FeedbackDeskItem = {
  id: "feedback-1",
  organizationId: "org-1",
  source: "telegram",
  sourceId: "source-1",
  kind: "bug",
  status: "triaged",
  priority: "normal",
  title: "redacted",
  description: "redacted",
  internalSummary: null,
  reporterName: null,
  reporterEmail: null,
  channelId: null,
  messageId: null,
  threadId: null,
  githubIssueUrl: "https://github.com/example/compass/issues/42",
  githubIssueNodeId: "issue-node-1",
  githubIssueCreationApprovedAt: null,
  githubIssueCreationApprovedBy: null,
  githubIssueCreationClaimToken: null,
  githubIssueCreationClaimedAt: null,
  featurePriorityApprovedAt: null,
  featurePriorityApprovedBy: null,
  githubDraftPullRequestUrl: null,
  assignedToUserId: null,
  assignedToName: null,
  slaTargetAt: null,
  triagedAt: null,
  resolvedAt: null,
  lastRequesterUpdateAt: null,
  lastGithubSyncAt: null,
  privacyScrubbedAt: null,
  deliveryGraphId: null,
  deliveryGraphStatus: null,
  deliveryGraphImplementationTaskId: null,
  deliveryGraphReviewTaskId: null,
  deliveryGraphReleaseTaskId: null,
  deliveryGraphLastError: null,
  deliveryGraphUpdatedAt: null,
  metadata: null,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
}

const githubResponse = {
  data: {
    node: {
      items: {
        nodes: [{
          content: {
            id: "issue-node-1",
            title: "Bug CFD-feedback-1",
            url: item.githubIssueUrl,
            state: "OPEN",
            closedByPullRequestsReferences: { nodes: [] },
          },
          fieldValues: {
            nodes: [{ name: "In progress", field: { name: "Status" } }],
          },
        }],
      },
    },
  },
}

describe("GitHub Feedback Desk synchronization evidence", () => {
  beforeEach(() => {
    mocks.getJarvisEnvValue.mockImplementation((_env: unknown, key: string) => {
      if (key === "GITHUB_TOKEN") return "token"
      if (key === "GITHUB_FEEDBACK_PROJECT_ID") return "project-1"
      if (key === "GITHUB_REPO") return "example/compass"
      return null
    })
    mocks.applyFeedbackLifecycleUpdate.mockReset()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => githubResponse,
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("does not import an unproven implementation state from GitHub", async () => {
    const result = await syncFeedbackDeskItemsFromGithub(
      Object.create(null),
      Object.assign(Object.create(null), {
        GITHUB_TOKEN: "token",
        GITHUB_FEEDBACK_PROJECT_ID: "project-1",
        GITHUB_REPO: "example/compass",
      }),
      [item],
    )

    expect(result).toBe(0)
    expect(mocks.applyFeedbackLifecycleUpdate).not.toHaveBeenCalled()
  })
})
