import { describe, expect, it } from "vitest"

import {
  feedbackReference,
  githubFeedbackIssueContent,
} from "@/lib/jarvis/feedback-github-content"

describe("Feedback Desk GitHub export", () => {
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
})
