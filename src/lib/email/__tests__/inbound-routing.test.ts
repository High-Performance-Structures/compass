import { describe, expect, it } from "vitest"

import {
  exactJobNumberMatches,
  inboundRecordKind,
  inboundRecordSubject,
  matchInboundProject,
} from "@/lib/email/inbound-routing"

const projects = [
  {
    id: "proj-h-office",
    projectNumber: "H-OFFICE",
    name: "Office, High Performance Structures Inc.",
  },
  {
    id: "proj-o-210-mitchell",
    projectNumber: "O-210-33",
    name: "Mitchell Residence",
  },
]

describe("inbound email routing", () => {
  it("routes an explicitly tagged office email to H-OFFICE", () => {
    const routed = (toAddress: string, subject: string) =>
      matchInboundProject({ toAddress, subject, textBody: "How much wood could a woodchuck chuck?", htmlBody: null, snippet: null }, projects)?.id ?? null

    expect(inboundRecordKind("[RFI] [OFFICE] Test RFI")).toBe("rfi")
    expect(inboundRecordSubject("[RFI] Test RFI for Office Forward")).toBe("Test RFI for Office Forward")
    expect(routed("rebekahecrampton@gmail.com", "[RFI] [OFFICE] Test RFI")).toBe("proj-h-office")
    expect(routed("rebekahecrampton@gmail.com", "[RFI] H-OFFICE test")).toBe("proj-h-office")
    // The Compass project inbox's +office address, alone or among others.
    expect(routed("Pat <pat@example.test>, Jarvis <jarvis+office@hps-colorado.com>", "[RFI] Test")).toBe("proj-h-office")
  })

  it("never picks the office job from another mailbox named office or a plain word", () => {
    const routed = (toAddress: string, subject: string) =>
      matchInboundProject({ toAddress, subject, textBody: "Septic tank locations attached.", htmlBody: null, snippet: null }, projects)?.id ?? null

    // A vendor's office@ mailbox (the 5565 Founders Place septic RFI).
    expect(routed("office@coloradogeosolutions.com", "[RFI] 5565 Founders Place Septic Tanks")).toBeNull()
    expect(routed("jarvis@hps-colorado.com, office@coloradogeosolutions.com", "[RFI] 5565 Founders Place Septic Tanks")).toBeNull()
    // Another mailbox's +office tag, and "office" as an ordinary word.
    expect(routed("bob+office@example.test", "[RFI] Question")).toBeNull()
    expect(routed("compass@hps-colorado.com", "[RFI] Test RFI for Office Forward")).toBeNull()
    expect(routed("compass@hps-colorado.com", "[RFI] Home office layout")).toBeNull()
  })

  it("prefers an explicit project number", () => {
    const match = matchInboundProject(
      {
        toAddress: "compass@hps-colorado.com",
        subject: "[RFI] O-210-33 foundation question",
        textBody: null,
        htmlBody: null,
        snippet: null,
      },
      projects
    )

    expect(match?.id).toBe("proj-o-210-mitchell")
  })

  it("matches job numbers only as whole tokens with a digit", () => {
    const jobs = [
      ...projects,
      { id: "proj-h-430", projectNumber: "H-430-1900", name: "Hill" },
      { id: "proj-o-20", projectNumber: "O-20", name: "Short" },
      { id: "proj-o-202", projectNumber: "O-202-595", name: "Pine" },
    ]
    const ids = (textBody: string): readonly string[] =>
      exactJobNumberMatches({ toAddress: "jarvis@example.test", subject: "Question", textBody, htmlBody: null, snippet: null }, jobs).map((job) => job.id)
    // A word-like job number never matches, even as a whole word.
    expect(ids("Thanks,\nPat\nOffice: 555-0100")).toEqual([])
    expect(exactJobNumberMatches({ toAddress: null, subject: "x", textBody: null, htmlBody: "<th>Office</th>", snippet: null }, jobs)).toEqual([])
    // Letters or digits touching the number break the match.
    expect(ids("Ph 430-1900")).toEqual([])
    expect(ids("See you in 2026.")).toEqual([])
    // A real number in a sentence matches, with or without separators.
    expect(ids("The O-202-595 deck is ready.")).toEqual(["proj-o-202"])
    expect(ids("Re: o202 595 framing")).toEqual(["proj-o-202"])
    expect(ids("Job H-430-1900, phone 430-1900")).toEqual(["proj-h-430"])
  })

  it("leaves ambiguous tagged email in review", () => {
    const match = matchInboundProject(
      {
        toAddress: "compass@hps-colorado.com",
        subject: "[RFI] Please review",
        textBody: "No project number was included.",
        htmlBody: null,
        snippet: null,
      },
      projects
    )

    expect(match).toBeNull()
  })
})
