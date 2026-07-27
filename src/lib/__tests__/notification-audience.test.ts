import { describe, expect, it } from "vitest"

import { eventAttendeeNotificationRecipients } from "@/lib/notifications/audience"

describe("notification audiences", () => {
  it("keeps the event creator when they selected themselves as an attendee", () => {
    expect(
      eventAttendeeNotificationRecipients([
        { userId: "creator", email: "creator@example.com" },
        { userId: "coworker", email: "coworker@example.com" },
      ])
    ).toEqual([
      { userId: "creator", email: "creator@example.com" },
      { userId: "coworker", email: "coworker@example.com" },
    ])
  })
})
