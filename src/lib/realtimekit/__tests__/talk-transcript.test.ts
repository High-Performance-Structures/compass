import { describe, expect, it } from "vitest"
import {
  addTranscriptEntry,
  EMPTY_TRANSCRIPT,
  finalTranscriptText,
  type TranscriptEntry,
} from "../talk-transcript"

const line = (
  id: string,
  minute: number,
  transcript: string,
  isPartialTranscript = false
): TranscriptEntry => ({
  id,
  name: "Speaker",
  transcript,
  isPartialTranscript,
  date: new Date(Date.UTC(2026, 9, 7, 16, minute)),
})

describe("talk transcript", () => {
  it("replaces partial captions in place and appends new lines", () => {
    let state = addTranscriptEntry(EMPTY_TRANSCRIPT, line("a", 1, "Hel", true))
    state = addTranscriptEntry(state, line("a", 1, "Hello", true))
    state = addTranscriptEntry(state, line("a", 1, "Hello there"))
    state = addTranscriptEntry(state, line("b", 2, "Next"))
    expect(state.entries.map((entry) => entry.transcript)).toEqual(["Hello there", "Next"])
    expect(state.indexByKey.get("b")).toBe(1)
  })

  it("keeps out-of-order lines sorted by time", () => {
    let state = addTranscriptEntry(EMPTY_TRANSCRIPT, line("late", 5, "Late"))
    state = addTranscriptEntry(state, line("early", 1, "Early"))
    state = addTranscriptEntry(state, line("late", 5, "Late, final"))
    expect(state.entries.map((entry) => entry.id)).toEqual(["early", "late"])
    expect(state.entries[1]?.transcript).toBe("Late, final")
  })

  it("exports only finalized lines", () => {
    let state = addTranscriptEntry(EMPTY_TRANSCRIPT, line("a", 1, "Done"))
    state = addTranscriptEntry(state, line("b", 2, "Still talk", true))
    expect(finalTranscriptText(state.entries)).toMatch(/Speaker: Done$/)
  })
})
