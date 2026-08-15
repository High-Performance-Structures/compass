import { describe, expect, it } from "vitest"

import { clientFollowUpState } from "@/lib/project-follow-up"

describe("client follow-up state", () => {
  it("shows business days since the last meaningful client interaction", () => {
    expect(
      clientFollowUpState({
        jobStatusId: "estimate_sent",
        interactions: [
          { occurredAt: "2026-08-14T16:00:00.000Z", deletedAt: null, qualifiesForClientTouch: true },
        ],
        nextFollowUpAt: null,
        now: new Date("2026-08-21T16:00:00.000Z"),
      }),
    ).toMatchObject({
      eligible: true,
      businessDaysSinceLastTouch: 5,
      state: "overdue",
    })
  })

  it("uses a staff-set follow-up date without losing the last-touch age", () => {
    expect(
      clientFollowUpState({
        jobStatusId: "engineering",
        interactions: [
          { occurredAt: "2026-08-18T16:00:00.000Z", deletedAt: null, qualifiesForClientTouch: true },
        ],
        nextFollowUpAt: "2026-08-25T16:00:00.000Z",
        now: new Date("2026-08-21T16:00:00.000Z"),
      }),
    ).toMatchObject({
      eligible: true,
      businessDaysSinceLastTouch: 3,
      state: "scheduled",
      nextFollowUpAt: "2026-08-25T16:00:00.000Z",
    })
  })

  it("keeps closed work out of the follow-up queue", () => {
    expect(
      clientFollowUpState({
        jobStatusId: "closed",
        interactions: [
          { occurredAt: "2026-08-14T16:00:00.000Z", deletedAt: null, qualifiesForClientTouch: true },
        ],
        nextFollowUpAt: null,
        now: new Date("2026-08-21T16:00:00.000Z"),
      }),
    ).toEqual({
      eligible: false,
      businessDaysSinceLastTouch: null,
      lastClientInteractionAt: null,
      nextFollowUpAt: null,
      state: "excluded",
    })
  })

  it("does not count a deleted interaction as a client touch", () => {
    expect(
      clientFollowUpState({
        jobStatusId: "intake",
        interactions: [
          { occurredAt: "2026-08-20T16:00:00.000Z", deletedAt: "2026-08-21T16:00:00.000Z", qualifiesForClientTouch: true },
        ],
        nextFollowUpAt: null,
        now: new Date("2026-08-21T16:00:00.000Z"),
      }),
    ).toMatchObject({
      eligible: true,
      businessDaysSinceLastTouch: null,
      state: "unrecorded",
    })
  })

  it("does not count an interaction that lacks the client-touch flag", () => {
    expect(
      clientFollowUpState({
        jobStatusId: "intake",
        interactions: [
          {
            occurredAt: "2026-08-20T16:00:00.000Z",
            deletedAt: null,
            qualifiesForClientTouch: false,
          },
        ],
        nextFollowUpAt: null,
        now: new Date("2026-08-21T16:00:00.000Z"),
      }),
    ).toMatchObject({
      eligible: true,
      businessDaysSinceLastTouch: null,
      state: "unrecorded",
    })
  })

  it("supports administrator-governed custom cadence without treating it as a built-in status", () => {
    expect(
      clientFollowUpState({
        jobStatusId: "custom-status-id",
        cadenceDays: 4,
        interactions: [
          { occurredAt: "2026-08-14T16:00:00.000Z", deletedAt: null, qualifiesForClientTouch: true },
        ],
        nextFollowUpAt: null,
        now: new Date("2026-08-21T16:00:00.000Z"),
      }),
    ).toMatchObject({ eligible: true, state: "overdue" })
  })

  it("does not include a custom status with no follow-up cadence", () => {
    expect(
      clientFollowUpState({
        jobStatusId: "custom-complete-id",
        cadenceDays: null,
        interactions: [],
        nextFollowUpAt: null,
        now: new Date("2026-08-21T16:00:00.000Z"),
      }),
    ).toMatchObject({ eligible: false, state: "excluded" })
  })
})
