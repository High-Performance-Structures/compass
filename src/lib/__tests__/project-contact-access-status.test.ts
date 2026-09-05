import { describe, expect, it } from "vitest"

import {
  projectContactCompassAccountStatus,
  projectContactAccessStatus,
  projectContactCanInvite,
} from "@/lib/project-contact-access-status"

const NOW = new Date("2026-07-29T20:00:00.000Z")

describe("projectContactCompassAccountStatus", () => {
  it("distinguishes active accounts, deactivated WorkOS accounts, and invite placeholders", () => {
    expect(
      projectContactCompassAccountStatus({ id: "user_active", isActive: true })
    ).toBe("active")
    expect(
      projectContactCompassAccountStatus({
        id: "user_deactivated",
        isActive: false,
      })
    ).toBe("inactive")
    expect(
      projectContactCompassAccountStatus({
        id: "pending-contact-1",
        isActive: false,
      })
    ).toBe("not_registered")
  })
})

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

  it("keeps project access grantable when an active account has a stale sent invitation", () => {
    expect(
      projectContactAccessStatus({
        activeProjectMember: false,
        compassAccountStatus: "active",
        latestInvitation: {
          status: "sent",
          workosExpiresAt: "2026-08-12T20:00:00.000Z",
          acceptedUserActive: null,
        },
        now: NOW,
      })
    ).toBe("not_invited")
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
