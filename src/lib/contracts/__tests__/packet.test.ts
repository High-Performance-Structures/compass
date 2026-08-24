import { describe, expect, test } from "vitest"

import {
  contractDepositCents,
  contractDocumentSchedule,
  dollarsInWords,
  fillContractTokens,
  parsePacketSigners,
} from "@/lib/contracts/packet"

describe("contract packet domain", () => {
  test("calculates a deposit from the estimate total and percentage", () => {
    expect(contractDepositCents(123_456_78, 1_250)).toBe(15_432_10)
  })

  test("spells contract currency with cents", () => {
    expect(dollarsInWords(1_234_567_89)).toBe(
      "One million two hundred thirty-four thousand five hundred sixty-seven dollars and 89/100"
    )
  })

  test("builds CA00's schedule from the actual selected documents", () => {
    const schedule = contractDocumentSchedule([{
      code: "CA18",
      title: "Homeowner's Warranty Manual",
      documentDate: null,
      revision: null,
      inclusionMode: "reference",
      signingStage: "reference",
    }])
    expect(schedule).toContain("CA18")
    expect(schedule).toContain("Incorporated by reference")
  })

  test("preserves visibly unresolved tokens", () => {
    expect(fillContractTokens("{{project.name}} / {{project.county}}", {
      "project.name": "Compass Developer",
    })).toBe("Compass Developer / {{project.county}}")
  })

  test("normalizes multiple client signers", () => {
    expect(parsePacketSigners(JSON.stringify([
      { name: "Alex Owner", email: "alex@example.com" },
      { name: "Pat Owner", initials: "PO" },
    ]))).toEqual([
      { contactId: null, name: "Alex Owner", title: "", email: "alex@example.com", initials: "AO" },
      { contactId: null, name: "Pat Owner", title: "", email: "", initials: "PO" },
    ])
  })
})
