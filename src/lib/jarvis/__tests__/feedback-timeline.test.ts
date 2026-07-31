import { describe, expect, it } from "vitest"

import { feedbackStatusFromGithub } from "@/lib/jarvis/feedback-github-sync"
import { feedbackTimeline } from "@/lib/jarvis/feedback-timeline"
import {
  confirmedFeedbackReportFromPayload,
  feedbackCandidateFromReport,
} from "@/lib/jarvis/feedback-confirmation"

describe("feedback request lifecycle", () => {
  it("maps GitHub Project workflow stages to requester-facing statuses", () => {
    expect(feedbackStatusFromGithub("Backlog", "OPEN")).toBe("triaged")
    expect(feedbackStatusFromGithub("Ready", "OPEN")).toBe("planned")
    expect(feedbackStatusFromGithub("In Progress", "OPEN")).toBe("in_progress")
    expect(feedbackStatusFromGithub("In Review", "OPEN")).toBe("testing")
    expect(feedbackStatusFromGithub("Done", "CLOSED")).toBe("deployed")
    expect(feedbackStatusFromGithub(null, "CLOSED")).toBe("closed")
  })

  it("builds a request history from durable lifecycle events", () => {
    const timeline = feedbackTimeline(
      {
        title: "Make requests interactive",
        status: "in_progress",
        createdAt: "2026-07-31T12:00:00.000Z",
      },
      [
        {
          eventType: "feedback.status_changed",
          payload: JSON.stringify({ status: "new" }),
          result: null,
          createdAt: "2026-07-31T12:00:01.000Z",
          completedAt: null,
        },
        {
          eventType: "feedback.status_updated",
          payload: "{}",
          result: JSON.stringify({
            status: "in_progress",
            message: "Development started.",
            updatedAt: "2026-07-31T13:00:00.000Z",
          }),
          createdAt: "2026-07-31T13:00:00.000Z",
          completedAt: "2026-07-31T13:00:00.000Z",
        },
      ],
    )

    expect(timeline).toHaveLength(2)
    expect(timeline[0]?.label).toBe("Submitted")
    expect(timeline[1]).toMatchObject({
      label: "In progress",
      message: "Development started.",
    })
  })

  it("recovers only explicitly confirmed Ask Jarvis requests", () => {
    const report = "The request list is broken and should update regularly."
    const payload = JSON.stringify({
      messages: [
        { role: "user", content: report },
        {
          role: "assistant",
          content: "Would you like me to file both requests?",
        },
        { role: "user", content: "Yes, please." },
      ],
    })
    expect(confirmedFeedbackReportFromPayload(payload)).toBe(report)
    expect(feedbackCandidateFromReport(report)).toMatchObject({
      kind: "bug",
      description: report,
    })

    const unconfirmed = JSON.stringify({
      messages: [
        { role: "user", content: report },
        { role: "assistant", content: "Here is how that works." },
        { role: "user", content: "Thanks." },
      ],
    })
    expect(confirmedFeedbackReportFromPayload(unconfirmed)).toBeNull()
  })
})
