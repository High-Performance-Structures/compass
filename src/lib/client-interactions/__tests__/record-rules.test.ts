import { describe, expect, it } from "vitest"
import { clientInteractionRecordProblem } from "@/lib/client-interactions/record-rules"

const settings = { minimumSummaryCharacters: 15, maximumBackdateDays: 30 }
const now = new Date("2026-10-10T18:00:00.000Z")

describe("clientInteractionRecordProblem", () => {
  it("accepts a real record", () => {
    expect(clientInteractionRecordProblem({ summary: "Called Ted, left voicemail about the revised estimate", occurredAt: "2026-10-10T16:00:00.000Z" }, settings, now)).toBeNull()
  })

  it("rejects a token summary", () => {
    expect(clientInteractionRecordProblem({ summary: "called", occurredAt: "2026-10-10T16:00:00.000Z" }, settings, now)).toContain("at least 15")
  })

  it("rejects future and too-old dates, and accepts small clock drift", () => {
    const summary = "Emailed the revised schedule to the owner"
    expect(clientInteractionRecordProblem({ summary, occurredAt: "2026-10-11T18:00:00.000Z" }, settings, now)).toContain("future")
    expect(clientInteractionRecordProblem({ summary, occurredAt: "2026-08-01T18:00:00.000Z" }, settings, now)).toContain("30 days")
    expect(clientInteractionRecordProblem({ summary, occurredAt: "2026-10-10T18:05:00.000Z" }, settings, now)).toBeNull()
  })
})
