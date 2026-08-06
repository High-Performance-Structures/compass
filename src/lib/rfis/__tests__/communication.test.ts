import { describe, expect, it } from "vitest"

import { appendRfiCommunication } from "@/lib/rfis/communication"

describe("appendRfiCommunication", () => {
  it("preserves imported history and appends a labeled response", () => {
    const result = appendRfiCommunication({
      existing: "Buildertrend response",
      message: "Please confirm the revised dimension.",
      author: "Martine Vogel",
      occurredAt: "2026-08-06T15:30:00.000Z",
    })

    expect(result).toContain("Buildertrend response")
    expect(result).toContain("Martine Vogel")
    expect(result).toContain("Please confirm the revised dimension.")
  })

  it("does not erase history when no message is supplied", () => {
    expect(
      appendRfiCommunication({
        existing: "Existing response",
        message: "  ",
        author: "Someone",
        occurredAt: "2026-08-06T15:30:00.000Z",
      })
    ).toBe("Existing response")
  })
})
