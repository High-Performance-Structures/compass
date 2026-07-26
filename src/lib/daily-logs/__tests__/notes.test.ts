import { describe, expect, it } from "vitest"

import { normalizeDailyLogNotes } from "@/lib/daily-logs/notes"

describe("normalizeDailyLogNotes", () => {
  it("removes an exact copy of work completed", () => {
    expect(
      normalizeDailyLogNotes(
        "Framing continued on the second floor.",
        "Framing continued on the second floor."
      )
    ).toBeNull()
  })

  it("removes copies that differ only by whitespace or case", () => {
    expect(
      normalizeDailyLogNotes(
        "Framing continued on the second floor.",
        "  FRAMING   continued on the second floor.  "
      )
    ).toBeNull()
  })

  it("preserves distinct next-step notes", () => {
    expect(
      normalizeDailyLogNotes(
        "Framing continued on the second floor.",
        "Complete the stair opening tomorrow."
      )
    ).toBe("Complete the stair opening tomorrow.")
  })

  it("normalizes blank notes to null", () => {
    expect(normalizeDailyLogNotes("Work completed.", "   ")).toBeNull()
    expect(normalizeDailyLogNotes("Work completed.", null)).toBeNull()
  })
})
