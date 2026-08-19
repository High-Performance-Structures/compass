import { describe, expect, it } from "vitest"

import {
  projectContactAccessStatus,
  projectContactCanInvite,
} from "@/lib/project-contact-access-status"

const NOW = new Date("2026-07-29T20:00:00.000Z")

describe("projectContactAccessStatus", () => {
  it("marks an active project member active without requiring an invitation", () => {
    expect(
      projectContactAccessStatus({
        activeProjectMember: true,
        latestInvitation: null,
        now: NOW,
      })
    ).toBe("active")
  })

  it("distinguishes contacts who have not been invited from pending invitations", () => {
    expect(
      projectContactAccessStatus({
        activeProjectMember: false,
        latestInvitation: null,
        now: NOW,
      })
    ).toBe("not_invited")

    expect(
      projectContactAccessStatus({
        activeProjectMember: false,
        latestInvitation: {
          status: "sent",
          workosExpiresAt: "2026-08-12T20:00:00.000Z",
          acceptedUserActive: null,
        },
        now: NOW,
      })
    ).toBe("pending")
  })

  it("infers expiry even before the stored invitation status is refreshed", () => {
    expect(
      projectContactAccessStatus({
        activeProjectMember: false,
        latestInvitation: {
          status: "sent",
          workosExpiresAt: "2026-07-28T20:00:00.000Z",
          acceptedUserActive: null,
        },
        now: NOW,
      })
    ).toBe("expired")
  })

  it("shows accepted deactivated accounts as inactive", () => {
    expect(
      projectContactAccessStatus({
        activeProjectMember: false,
        latestInvitation: {
          status: "accepted",
          workosExpiresAt: null,
          acceptedUserActive: false,
        },
        now: NOW,
      })
    ).toBe("inactive")
  })
})

describe("projectContactCanInvite", () => {
  it("allows new and expired invitations without duplicating current access", () => {
    expect(projectContactCanInvite("not_invited")).toBe(true)
    expect(projectContactCanInvite("expired")).toBe(true)
    expect(projectContactCanInvite("pending")).toBe(false)
    expect(projectContactCanInvite("active")).toBe(false)
    expect(projectContactCanInvite("inactive")).toBe(false)
  })
})
