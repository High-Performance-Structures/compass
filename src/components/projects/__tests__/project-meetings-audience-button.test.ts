import { describe, expect, it } from "vitest"

import { joinableMeeting } from "@/components/projects/project-meetings-audience-button"
import type { GuestClientMeeting } from "@/lib/client-meetings/guest-meetings"

function meeting(id: string, startsAt: string, endsAt: string): GuestClientMeeting {
  return { id, title: id, startsAt, endsAt, meetingUrl: `https://meet.google.com/${id}`, hostName: "Host" }
}

describe("owner and vendor Project Meetings button", () => {
  const later = meeting("later", "2026-10-25T18:00:00.000Z", "2026-10-25T18:30:00.000Z")
  const soon = meeting("soon", "2026-10-25T16:05:00.000Z", "2026-10-25T16:35:00.000Z")

  it("reads Join meeting from ten minutes before a call until it ends", () => {
    expect(joinableMeeting([later, soon], Date.parse("2026-10-25T15:50:00.000Z"))).toBeNull()
    expect(joinableMeeting([later, soon], Date.parse("2026-10-25T15:56:00.000Z"))?.id).toBe("soon")
    expect(joinableMeeting([later, soon], Date.parse("2026-10-25T16:34:00.000Z"))?.id).toBe("soon")
    expect(joinableMeeting([later, soon], Date.parse("2026-10-25T16:36:00.000Z"))).toBeNull()
  })

  it("stays Project Meetings with nothing scheduled", () => {
    expect(joinableMeeting([], Date.parse("2026-10-25T16:00:00.000Z"))).toBeNull()
  })
})
