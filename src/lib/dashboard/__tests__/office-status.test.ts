import { describe, expect, it } from "vitest"

import {
  DESK_STATUS_LABELS,
  deskStatusForPresenceMessage,
  deskStatusFromPresenceMessage,
  teamAvailabilityFromRows,
} from "@/lib/dashboard/office-status"

describe("deskStatusForPresenceMessage", () => {
  it.each(Object.entries(DESK_STATUS_LABELS))(
    "restores %s from its saved presence message",
    (status, label) => {
      expect(deskStatusForPresenceMessage(label)).toBe(status)
    }
  )

  it("defaults to in-office when no recognized status has been saved", () => {
    expect(deskStatusForPresenceMessage(null)).toBe("in-office")
    expect(deskStatusForPresenceMessage("Heads down")).toBe("in-office")
  })
})

describe("deskStatusFromPresenceMessage", () => {
  it("does not treat an unset or unrelated chat status as office availability", () => {
    expect(deskStatusFromPresenceMessage(null)).toBeNull()
    expect(deskStatusFromPresenceMessage("Heads down")).toBeNull()
  })
})

describe("teamAvailabilityFromRows", () => {
  it("shares the newest saved availability between distinct staff users", () => {
    const availability = teamAvailabilityFromRows(
      [
        {
          userId: "martine",
          email: "martine@example.com",
          firstName: "Martine",
          lastName: "Vogel",
          displayName: "Martine Vogel",
          avatarUrl: "/martine.jpg",
          role: "admin",
          statusMessage: "In Office",
          lastActiveAt: "2026-07-27T14:30:00.000Z",
          updatedAt: "2026-07-27T15:00:00.000Z",
        },
        {
          userId: "sylvi",
          email: "sylvi@example.com",
          firstName: "Sylvi",
          lastName: "Example",
          displayName: "Sylvi Example",
          avatarUrl: null,
          role: "office",
          statusMessage: "Out",
          lastActiveAt: "2026-07-27T13:30:00.000Z",
          updatedAt: "2026-07-27T14:00:00.000Z",
        },
        {
          userId: "sylvi",
          email: "sylvi@example.com",
          firstName: "Sylvi",
          lastName: "Example",
          displayName: "Sylvi Example",
          avatarUrl: null,
          role: "office",
          statusMessage: "Remote",
          lastActiveAt: "2026-07-27T15:45:00.000Z",
          updatedAt: "2026-07-27T16:00:00.000Z",
        },
        {
          userId: "owner",
          email: "owner@example.com",
          firstName: "Project",
          lastName: "Owner",
          displayName: "Project Owner",
          avatarUrl: null,
          role: "client",
          statusMessage: "In Office",
          lastActiveAt: "2026-07-27T15:45:00.000Z",
          updatedAt: "2026-07-27T16:00:00.000Z",
        },
      ],
      "martine",
      new Date("2026-07-27T16:00:00.000Z")
    )

    expect(availability).toEqual([
      {
        userId: "martine",
        name: "Martine Vogel",
        avatarUrl: "/martine.jpg",
        status: "in-office",
        activity: "idle",
        lastActiveAt: "2026-07-27T14:30:00.000Z",
        updatedAt: "2026-07-27T15:00:00.000Z",
        isCurrentUser: true,
      },
      {
        userId: "sylvi",
        name: "Sylvi Example",
        avatarUrl: null,
        status: "remote",
        activity: "active",
        lastActiveAt: "2026-07-27T15:45:00.000Z",
        updatedAt: "2026-07-27T16:00:00.000Z",
        isCurrentUser: false,
      },
    ])
  })

  it("omits staff who have not set dashboard availability", () => {
    expect(
      teamAvailabilityFromRows(
        [
          {
            userId: "unset",
            email: "unset@example.com",
            firstName: null,
            lastName: null,
            displayName: null,
            avatarUrl: null,
            role: "office",
            statusMessage: null,
            lastActiveAt: null,
            updatedAt: null,
          },
        ],
        "martine"
      )
    ).toEqual([])
  })
})
