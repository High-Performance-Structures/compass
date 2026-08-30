import { describe, expect, it } from "vitest"

import {
  acceptedEstimateDateLabel,
  acceptedEstimateDocumentUrl,
  acceptedEstimateEvidenceUrl,
} from "@/lib/estimates/accepted-document"

describe("acceptedEstimateDocumentUrl", () => {
  it("uses the canonical HTTPS document for an accepted estimate", () => {
    expect(
      acceptedEstimateDocumentUrl({
        status: "accepted",
        signaturePackageUrl: "https://drive.google.com/file/d/source/view",
      })
    ).toBe("https://drive.google.com/file/d/source/view")
  })

  it("keeps generated reports available before acceptance", () => {
    expect(
      acceptedEstimateDocumentUrl({
        status: "client_review",
        signaturePackageUrl: "https://drive.google.com/file/d/source/view",
      })
    ).toBeNull()
  })

  it("rejects missing, malformed, and non-HTTPS evidence links", () => {
    expect(
      acceptedEstimateDocumentUrl({
        status: "accepted",
        signaturePackageUrl: null,
      })
    ).toBeNull()
    expect(
      acceptedEstimateDocumentUrl({
        status: "accepted",
        signaturePackageUrl: "not a URL",
      })
    ).toBeNull()
    expect(
      acceptedEstimateDocumentUrl({
        status: "accepted",
        signaturePackageUrl: "http://example.com/estimate.pdf",
      })
    ).toBeNull()
  })

  it("allows only the same-origin Foxit path as non-HTTPS accepted evidence", () => {
    expect(
      acceptedEstimateEvidenceUrl({
        status: "accepted",
        signaturePackageUrl: "/api/integrations/foxit/envelopes/id/document",
      })
    ).toBe("/api/integrations/foxit/envelopes/id/document")
    expect(
      acceptedEstimateEvidenceUrl({
        status: "accepted",
        signaturePackageUrl: "//evil.example/document.pdf",
      })
    ).toBeNull()
    expect(
      acceptedEstimateEvidenceUrl({
        status: "accepted",
        signaturePackageUrl: "/\\evil.example/document.pdf",
      })
    ).toBeNull()
    expect(
      acceptedEstimateEvidenceUrl({
        status: "accepted",
        signaturePackageUrl: "http://evil.example/document.pdf",
      })
    ).toBeNull()
  })

  it("formats the recorded source date without a server/client timezone shift", () => {
    expect(acceptedEstimateDateLabel("2025-05-30T19:08:00-06:00")).toBe(
      "5/30/2025"
    )
    expect(acceptedEstimateDateLabel(null)).toBe("Date not recorded")
    expect(acceptedEstimateDateLabel("2025-02-30")).toBe("Date not recorded")
  })
})
