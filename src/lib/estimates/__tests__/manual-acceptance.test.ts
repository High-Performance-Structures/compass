import { describe, expect, it } from "vitest"

import {
  estimateAcceptanceDate,
  estimateAcceptanceMethodLabel,
  isEstimateAcceptanceMethod,
  validateEstimateAcceptanceEvidence,
} from "@/lib/estimates/manual-acceptance"

describe("manual estimate acceptance", () => {
  it("accepts signed-document methods but keeps Foxit distinguishable", () => {
    expect(isEstimateAcceptanceMethod("wet_signature")).toBe(true)
    expect(isEstimateAcceptanceMethod("external_esignature")).toBe(true)
    expect(isEstimateAcceptanceMethod("foxit")).toBe(true)
    expect(isEstimateAcceptanceMethod("verbal_approval")).toBe(false)
    expect(estimateAcceptanceMethodLabel("wet_signature")).toBe(
      "Printed and signed document"
    )
  })

  it("records the client-selected acceptance date and rejects future dates", () => {
    const now = new Date("2026-08-22T18:00:00.000Z")
    expect(estimateAcceptanceDate("2026-08-21", now)).toBe(
      "2026-08-21T12:00:00.000Z"
    )
    expect(() => estimateAcceptanceDate("2026-08-23", now)).toThrow(
      "cannot be in the future"
    )
  })

  it("allows common signed-document files within the upload limit", () => {
    expect(() =>
      validateEstimateAcceptanceEvidence({
        size: 1_024,
        type: "application/pdf",
      })
    ).not.toThrow()
    expect(() =>
      validateEstimateAcceptanceEvidence({
        size: 51 * 1024 * 1024,
        type: "application/pdf",
      })
    ).toThrow("50 MB or smaller")
    expect(() =>
      validateEstimateAcceptanceEvidence({
        size: 1_024,
        type: "application/javascript",
      })
    ).toThrow("PDF, Word document, or image")
  })
})
