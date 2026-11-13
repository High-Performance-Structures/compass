import { describe, expect, it } from "vitest"

import { heldEmailReason } from "@/lib/email/held-email-reasons"

function reason(metadata: Record<string, unknown> | null, text = "Please check the finish.", projectId: string | null = "project-a"): string {
  return heldEmailReason({ hasActivity: metadata !== null, activityMetadata: metadata ? JSON.stringify(metadata) : null, projectId, text }).label
}

describe("heldEmailReason", () => {
  it("names the reason the routing recorded", () => {
    expect(reason({ senderAuthorized: true, destination: "message", heldReason: "no_recipients" })).toBe("No one to notify on this job")
    expect(reason({ senderAuthorized: true, destination: "message", heldReason: "mention_unmatched" })).toBe("An @name couldn't be matched")
    expect(reason({ senderAuthorized: true, destination: "message", heldReason: "attachment_failed" })).toBe("An attachment couldn't be saved")
    expect(reason({ senderAuthorized: true, destination: "message", heldReason: "messaging_off" })).toBe("Job messages aren't turned on for this job")
  })

  it("reads older holds from what they recorded", () => {
    expect(reason({ senderAuthorized: false, subjectTagged: false })).toBe("Sender isn't a contact on this job")
    expect(reason({ senderAuthorized: true, subjectTagged: false })).toBe("No subject tag to say where it goes")
    expect(reason({ senderAuthorized: true, destination: "message" }, '@"Nobody" please call')).toBe("An @name couldn't be matched")
    expect(reason({ senderAuthorized: true, destination: "message" })).toBe("Couldn't post to job messages: no one to notify, or an attachment couldn't be saved")
  })

  it("falls back to a generic reason", () => {
    expect(reason({ heldReason: "something new" })).toBe("Compass couldn't post it on its own")
    expect(heldEmailReason({ hasActivity: true, activityMetadata: "not json", projectId: "project-a", text: "" }).label).toBe("Compass couldn't post it on its own")
    expect(reason(null)).toBe("Compass couldn't post it on its own")
    expect(reason(null, "", null)).toBe("Compass couldn't tell which job it's for")
  })
})
