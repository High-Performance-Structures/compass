import { describe, expect, it } from "vitest"

import {
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
  it("routes Wes's tagged office test to H-OFFICE", () => {
    const match = matchInboundProject(
      {
        toAddress: "rebekahecrampton@gmail.com",
        subject: "[RFI] Test RFI for Office Forward",
        textBody: "How much wood could a woodchuck chuck?",
        htmlBody: null,
        snippet: null,
      },
      projects
    )

    expect(inboundRecordKind("[RFI] Test RFI for Office Forward")).toBe("rfi")
    expect(inboundRecordSubject("[RFI] Test RFI for Office Forward")).toBe(
      "Test RFI for Office Forward"
    )
    expect(match?.id).toBe("proj-h-office")
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
