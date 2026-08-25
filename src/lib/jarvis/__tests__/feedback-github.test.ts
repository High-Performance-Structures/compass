import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getJarvisEnvValue: vi.fn(),
}))

vi.mock("@/lib/jarvis/auth", () => ({
  getJarvisEnvValue: mocks.getJarvisEnvValue,
}))

import {
  feedbackReference,
  githubFeedbackIssueContent,
} from "@/lib/jarvis/feedback-github-content"
import { linkFeedbackDeskItemToGithub } from "@/lib/jarvis/feedback-github"
import type { FeedbackDeskItem } from "@/db/schema-jarvis"

const staleFeature: FeedbackDeskItem = {
  id: "feature-1",
  organizationId: "org-1",
  source: "feedback-widget",
  sourceId: "source-1",
  kind: "feature",
  status: "new",
  priority: "normal",
  title: "redacted",
  description: "redacted",
  internalSummary: null,
  reporterName: null,
  reporterEmail: null,
  channelId: null,
  messageId: null,
  threadId: null,
  githubIssueUrl: null,
  githubIssueNodeId: null,
  githubIssueCreationApprovedAt: "2026-08-12T00:00:00.000Z",
  githubIssueCreationApprovedBy: "admin-1",
  githubIssueCreationClaimToken: null,
  githubIssueCreationClaimedAt: null,
  githubIssueCreationClaimExpiresAt: null,
  githubIssueCreationProviderAttemptedAt: null,
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
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
}

describe("Feedback Desk GitHub export", () => {
  beforeEach(() => {
    mocks.getJarvisEnvValue.mockImplementation((_env: unknown, key: string) => {
      if (key === "GITHUB_TOKEN") return "token"
      if (key === "GITHUB_REPO") return "example/compass"
      return null
    })
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses only a kind and opaque reference in a GitHub issue", () => {
    const issue = githubFeedbackIssueContent({
      id: "f43e6e9a-1889-4ce0-9d16-6b6f13d57b58",
      kind: "bug",
    })

    expect(issue.title).toBe(
      "[Compass feedback] bug · CFD-f43e6e9a-1889-4ce0-9d16-6b6f13d57b58",
    )
    expect(issue.body).toContain(feedbackReference("f43e6e9a-1889-4ce0-9d16-6b6f13d57b58"))
    expect(issue.body).not.toContain("telegram")
    expect(issue.body).not.toContain("@example.com")
    expect(issue.labels).toEqual(["bug", "feedback"])
  })

  it("fails closed at the GitHub creation primitive for stale feature approval", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            get: async () => staleFeature,
          }),
        }),
      }),
    }
    const result = await linkFeedbackDeskItemToGithub(
      // @ts-expect-error This unit test only exercises the current-row read.
      db,
      Object.create(null),
      staleFeature,
    )

    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
