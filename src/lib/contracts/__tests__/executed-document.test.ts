import { describe, expect, it } from "vitest"

import { validateExecutedContractDocumentReplacement } from "@/lib/contracts/executed-document"

describe("executed contract document replacement", () => {
  it("normalizes a secure replacement and preserves its audit reason", () => {
    expect(
      validateExecutedContractDocumentReplacement({
        evidenceUrl: " https://drive.google.com/file/d/executed/view ",
        evidenceLabel: " Executed contract.pdf ",
        reason: " Replaced the trial-watermarked archive copy. ",
        attested: true,
      })
    ).toEqual({
      url: "https://drive.google.com/file/d/executed/view",
      label: "Executed contract.pdf",
      reason: "Replaced the trial-watermarked archive copy.",
    })
  })

  it("requires an attestation and a secure saved document", () => {
    expect(() =>
      validateExecutedContractDocumentReplacement({
        evidenceUrl: "http://example.com/contract.pdf",
        evidenceLabel: "Executed contract.pdf",
        reason: "Corrected archive copy.",
        attested: false,
      })
    ).toThrow("Confirm that the replacement is the same fully executed contract packet.")

    expect(() =>
      validateExecutedContractDocumentReplacement({
        evidenceUrl: "http://example.com/contract.pdf",
        evidenceLabel: "Executed contract.pdf",
        reason: "Corrected archive copy.",
        attested: true,
      })
    ).toThrow("secure HTTPS link")

    expect(() =>
      validateExecutedContractDocumentReplacement({
        evidenceUrl: "not a link",
        evidenceLabel: "Executed contract.pdf",
        reason: "Corrected archive copy.",
        attested: true,
      })
    ).toThrow("valid replacement contract link")
  })
})
