import { describe, expect, it } from "vitest"

import { defaultRfiEmailSubject, rfiEmailText } from "@/lib/rfis/email"

describe("RFI email", () => {
  it("puts the note above the RFI question", () => {
    expect(defaultRfiEmailSubject({ rfiNumber: "RFI-002", subject: "Beam size" })).toBe("[RFI-002] Beam size")
    const text = rfiEmailText({
      projectLabel: "H-430 - Ezell Residence",
      rfiNumber: "RFI-002",
      subject: "Beam size",
      question: "Confirm the ridge beam size.",
      dueDate: "2026-10-23",
      message: "Need this before framing.",
      senderName: "Cassandra",
    })
    expect(text.startsWith("Need this before framing.\n\nH-430 - Ezell Residence\nRFI RFI-002: Beam size")).toBe(true)
    expect(text).toContain("Response needed by October 23, 2026")
    expect(text).toContain("Question:\nConfirm the ridge beam size.")
  })

  it("starts with the RFI when there is no note", () => {
    const text = rfiEmailText({
      projectLabel: "Ezell",
      rfiNumber: "RFI-1",
      subject: "S",
      question: "Q",
      dueDate: null,
      message: "  ",
      senderName: "C",
    })
    expect(text.startsWith("Ezell\n")).toBe(true)
    expect(text).not.toContain("Response needed")
  })
})
