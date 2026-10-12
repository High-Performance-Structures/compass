import { describe, expect, it } from "vitest"
import { buildLeaderboard, periodStart, streakDays } from "@/lib/client-follow-up/leaderboard"

// Friday 2026-10-09.
const now = new Date("2026-10-09T20:00:00.000Z")
const item = (createdBy: string | null, occurredAt: string, interactionType = "call", source = "manual") => ({
  createdBy,
  createdByName: createdBy ? createdBy.toUpperCase() : null,
  interactionType,
  occurredAt,
  source,
})

describe("periodStart", () => {
  it("starts weeks on Monday and months on the 1st", () => {
    expect(periodStart("week", now).toISOString()).toBe("2026-10-05T00:00:00.000Z")
    expect(periodStart("month", now).toISOString()).toBe("2026-10-01T00:00:00.000Z")
    expect(periodStart("quarter", now).toISOString()).toBe("2026-10-01T00:00:00.000Z")
  })
})

describe("streakDays", () => {
  it("counts consecutive business days across a weekend and ignores an empty today", () => {
    const days = new Set(["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"])
    expect(streakDays(days, now)).toBe(6)
    expect(streakDays(new Set(["2026-10-09", "2026-10-07"]), now)).toBe(1)
  })
})

describe("buildLeaderboard", () => {
  it("ranks people by logged contacts with type breakdown and skips records with no person", () => {
    const period = [
      item("sam", "2026-10-06T15:00:00.000Z"),
      item("sam", "2026-10-07T15:00:00.000Z", "email"),
      item("ann", "2026-10-08T15:00:00.000Z"),
      item(null, "2026-10-08T15:00:00.000Z"),
    ]
    const board = buildLeaderboard({ periodInteractions: period, streakInteractions: period, countAutomaticEmails: true, now })
    expect(board.map((entry) => [entry.userId, entry.total])).toEqual([["sam", 2], ["ann", 1]])
    expect(board[0]?.byType).toEqual({ call: 1, email: 1 })
  })

  it("can leave out automatic emails", () => {
    const period = [item("sam", "2026-10-06T15:00:00.000Z", "email", "nutech_email")]
    expect(buildLeaderboard({ periodInteractions: period, streakInteractions: period, countAutomaticEmails: false, now })).toEqual([])
  })
})
