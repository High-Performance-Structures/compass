import { describe, expect, it } from "vitest"
import { historicalSubmitterDisplay, historicalVendorNotes } from "../historical-display"

describe("historical submitter display", () => {
  it("preserves an explicitly captured name without mapping it to the current vendor or user", () => {
    expect(historicalSubmitterDisplay({ vendor: { displayName: "Vendor company", legacyParticipantEvidence: { submittedBy: "Original Person" } } })).toBe("Original Person")
    expect(historicalSubmitterDisplay({ vendor: { displayName: "Vendor company" }, status: { submittedDisplay: "Yesterday by someone" } })).toBeNull()
    expect(historicalSubmitterDisplay({ vendor: { legacyParticipantEvidence: { submittedBy: "--", email: "private@example.test" } } })).toBeNull()
  })
})

describe("historical vendor notes", () => {
  it("preserves exact recognized note text without accepting other capture fields", () => {
    expect(historicalVendorNotes({ notes: { notesFromVendorDisplay: "Includes tax\nand delivery" }, privateEmail: "secret" }))
      .toBe("Includes tax\nand delivery")
    expect(historicalVendorNotes({ privateEmail: "secret", notes: { internalNotes: "private" } })).toBeNull()
    expect(historicalVendorNotes({ notes: { notesFromVendorDisplay: "--" } })).toBeNull()
  })
  it("reads only the recognized older adapter's vendor note and safely holds malformed evidence", () => {
    const legacyEvidence = { adapter: "o152-older-source-adapter-v1", sourcePayloadJson: JSON.stringify({ responseEvidence: { notes: "Tax included" } }) }
    expect(historicalVendorNotes({ legacyEvidence })).toBe("Tax included")
    expect(historicalVendorNotes({ legacyEvidence: { ...legacyEvidence, adapter: "unknown" } })).toBeNull()
    expect(historicalVendorNotes({ legacyEvidence: { ...legacyEvidence, sourcePayloadJson: "{" } })).toBeNull()
  })
})
