import { describe, expect, it } from "vitest"

import { clientFollowUpState, followUpThresholds, projectAgingLevel, PROJECT_AGING_LEVELS } from "@/lib/project-follow-up"

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

describe("project aging thresholds", () => {
  const now = new Date("2026-10-09T18:00:00.000Z") // Friday
  const contact = (occurredAt: string) => [{ occurredAt, deletedAt: null, qualifiesForClientTouch: true }]

  it("uses the status cadence unless the company overrides it", () => {
    expect(followUpThresholds({ jobStatusId: "follow_up", settings: { statuses: {} } })).toEqual({ dueDays: 2, overdueDays: 3 })
    expect(
      followUpThresholds({ jobStatusId: "follow_up", settings: { statuses: { follow_up: { dueDays: 4, overdueDays: 8 } } } }),
    ).toEqual({ dueDays: 4, overdueDays: 8 })
    expect(followUpThresholds({ jobStatusId: "complete", settings: { statuses: {} } })).toBeNull()
    expect(followUpThresholds({ jobStatusId: "custom-1", customCadenceDays: 5, settings: { statuses: {} } })).toEqual({ dueDays: 5, overdueDays: 6 })
  })

  it("turns due, then overdue, by the company thresholds", () => {
    const thresholds = { dueDays: 3, overdueDays: 5 }
    const state = (occurredAt: string) =>
      clientFollowUpState({ jobStatusId: "estimate_sent", thresholds, interactions: contact(occurredAt), nextFollowUpAt: null, now }).state
    expect(state("2026-10-07T15:00:00.000Z")).toBe("current") // 2 business days
    expect(state("2026-10-06T15:00:00.000Z")).toBe("due") // 3
    expect(state("2026-10-02T15:00:00.000Z")).toBe("overdue") // 5
  })

  it("treats a future follow-up as scheduled even before any contact is logged", () => {
    const result = clientFollowUpState({
      jobStatusId: "estimate_sent",
      interactions: [],
      nextFollowUpAt: "2026-10-12T14:00:00.000Z",
      now,
    })
    expect(result.state).toBe("scheduled")
    expect(projectAgingLevel(result.state)).toBe("scheduled")
  })

  it("maps states to the shared aging levels", () => {
    expect(projectAgingLevel("overdue")).toBe("overdue")
    expect(projectAgingLevel("unrecorded")).toBe("no_contact")
    expect(projectAgingLevel("excluded")).toBeNull()
    expect(PROJECT_AGING_LEVELS.overdue.colorToken).toBe("--destructive")
  })
})
