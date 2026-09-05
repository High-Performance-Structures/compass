import { describe, expect, it } from "vitest"

import type { RfqHistoricalScope } from "@/lib/rfqs/historical-requests"
import { adaptPreservedCapture } from "@/lib/rfqs/preserved-source-adapter"

const scope: RfqHistoricalScope = {
  organizationId: "org-test",
  projectId: "project-test",
  buildertrendJobId: "7001",
  bidPackageId: "8001",
  canonicalDriveRootId: "drive-root-test",
}

const sourceHref = "https://buildertrend.net/app/BidPackages/BidPackage/8001/7001/Bid/1001/7001/0/0?initialTab=general"

function preservedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "buildertrend-rfq-request-preserved-v1",
    projectId: "project-test",
    buildertrendJobId: "7001",
    bidPackageId: "8001",
    bidId: "1001",
    vendor: "Synthetic Vendor",
    status: "Submitted",
    sourceHref,
    sourceArtifact: "synthetic-source-capture.json",
    sourceArtifactSha256: "a".repeat(64),
    parentRfqRecordId: "bt-module-rfq-7001-8001",
    parentRfqSourceKey: "rfq:7001:8001",
    recordDateSemantics: "Calendar/display strings are preserved; no timezone inferred.",
    requestEvidence: {
      sourceBidRequestId: "1001",
      sourceHref,
      vendorDisplay: "Synthetic Vendor",
      status: "Submitted",
      releasedDisplay: "Aug 1, 2026",
      submittedDisplay: "Aug 4, 2026, 11:30 AM by Synthetic Vendor",
      timezone: "not exposed; not inferred",
      amountDisplay: "$1,250.00",
      totalDisplay: "$1,250.00",
      pricedSubmission: true,
      includeInEstimateChecked: false,
      lines: [
        {
          title: "Service panel",
          description: "Panel and breakers",
          costCode: "26-100",
          costType: "Material",
          unitCostDisplay: "$800.00",
          quantityDisplay: "1",
          unitDisplay: "LS",
          builderCostDisplay: "$800.00",
          expandedDescription: "Panel, breakers, and labels",
        },
        {
          title: "Installation",
          description: "Install service panel",
          costCode: "26-200",
          costType: "Labor",
          unitCostDisplay: "$450.00",
          quantityDisplay: "1",
          unitDisplay: "LS",
          builderCostDisplay: "$450.00",
          expandedDescription: "--",
        },
      ],
      notes: { notesFromVendorDisplay: "Synthetic source note." },
      attachments: [
        { fileName: "Proposal.pdf", sourceDocumentInstanceId: "9001", viewerPageCount: 1 },
      ],
    },
    sourceFieldsArePreserved: true,
    sourcePackageEvidence: { title: "Synthetic package" },
    attachmentEvidence: [
      { fileName: "Proposal.pdf", sourceDocumentInstanceId: "9001", viewerPageCount: 1 },
    ],
    importedAs: "Historical staging evidence only; no approval or access grant.",
    recipientAccessVerified: false,
    ...overrides,
  }
}

function serialize(value: unknown): string {
  const result = JSON.stringify(value)
  if (result === undefined) throw new Error("fixture must be serializable")
  return result
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

describe("preserved Buildertrend RFQ source adapter", () => {
  it("accepts submitted captures, preserves raw JSON, and marks captured money", () => {
    const payload = preservedPayload()
    const payloadJson = serialize(payload)
    const result = adaptPreservedCapture(payload, payloadJson, scope)
    expect(result.success).toBe(true)
    if (!result.success) return
    const request = result.requests[0]
    expect(request).toMatchObject({
      requestId: "1001",
      sourceStatus: "Submitted",
      submission: "submitted",
      amountDisplayProvenance: "captured",
      sourceAmountDisplay: "$1,250.00",
      submittedAmountCents: 125000,
      pricingReconciliation: "exact",
    })
    expect(request?.attachments).toEqual([{ documentInstanceId: "9001", label: "Proposal.pdf", status: "held", reason: "original_not_verified" }])
    expect(request?.lines[0]).toMatchObject({ costCodeDisplay: "26-100", costTypeDisplay: "Material" })
    expect(request?.lines[1]).toMatchObject({ costCodeDisplay: "26-200", costTypeDisplay: "Labor" })
    const captured: unknown = request === undefined ? null : JSON.parse(request.capturedRequestJson)
    expect(record(captured) && record(captured.legacyEvidence) ? captured.legacyEvidence.sourcePayloadJson : null).toBe(payloadJson)
    expect(record(captured) && record(captured.legacyEvidence) ? captured.legacyEvidence.adapter : null).toBe("buildertrend-rfq-request-preserved-v1")
  })

  it("retains recognized cost display aliases without changing money or raw provenance", () => {
    const base = preservedPayload()
    if (!record(base.requestEvidence)) throw new Error("expected request evidence")
    const payload = preservedPayload({ requestEvidence: {
      ...base.requestEvidence,
      lines: [{ title: "Synthetic aliased scope", costCodeDisplay: "26-300", costTypeDisplay: "Subcontract",
        unitCostDisplay: "$1,250.00", quantityDisplay: "1", unitDisplay: "LS", builderCostDisplay: "$1,250.00" }],
    } })
    const payloadJson = serialize(payload)
    const result = adaptPreservedCapture(payload, payloadJson, scope)
    expect(result.success).toBe(true)
    if (!result.success) return
    const request = result.requests[0]
    expect(request?.lines).toEqual([expect.objectContaining({ costCodeDisplay: "26-300", costTypeDisplay: "Subcontract",
      unitCostDisplay: "$1,250.00", quantityDisplay: "1", unitDisplay: "LS", submittedLineAmountCents: 125000 })])
    expect(request).toMatchObject({ submittedAmountCents: 125000, pricingReconciliation: "exact" })
    const captured: unknown = request === undefined ? null : JSON.parse(request.capturedRequestJson)
    expect(record(captured) && record(captured.legacyEvidence) ? captured.legacyEvidence.sourcePayloadJson : null).toBe(payloadJson)
  })

  it("lists draft captures without treating them as priced submissions", () => {
    const base = preservedPayload()
    if (!record(base.requestEvidence)) throw new Error("expected request evidence")
    const payload = preservedPayload({
      status: "Draft",
      requestEvidence: {
        ...base.requestEvidence,
        status: "Draft",
        submittedDisplay: "--",
        amountDisplay: "$0.00",
        totalDisplay: "$0.00",
        pricedSubmission: false,
        lines: [],
        attachments: [],
      },
      attachmentEvidence: [],
    })
    const result = adaptPreservedCapture(payload, serialize(payload), scope)
    expect(result.success).toBe(true)
    if (!result.success) return
    const request = result.requests[0]
    expect(request).toMatchObject({
      submission: "draft",
      pricingReconciliation: "unpriced",
      submittedAmountCents: null,
      amountDisplayProvenance: "captured",
    })
    expect(request).not.toHaveProperty("approvedByUserId")
    expect(request).not.toHaveProperty("approvedAt")
  })

  it("retains a submitted unpriced response without inventing a bid amount", () => {
    const base = preservedPayload()
    if (!record(base.requestEvidence)) throw new Error("expected request evidence")
    const payload = preservedPayload({
      requestEvidence: { ...base.requestEvidence, pricedSubmission: false,
        amountDisplay: "--", totalDisplay: "--", lines: [] },
    })
    const raw = serialize(payload)
    const result = adaptPreservedCapture(payload, raw, scope)
    expect(result.success).toBe(true)
    if (!result.success) return
    const request = result.requests[0]
    expect(request).toMatchObject({ vendorDisplay: "Synthetic Vendor", sourceStatus: "Submitted",
      submission: "submitted", pricingReconciliation: "unpriced", submittedAmountCents: null,
      sourceAmountDisplay: "--", submittedDisplay: "Aug 4, 2026, 11:30 AM by Synthetic Vendor" })
    expect(request?.attachments).toEqual([{ documentInstanceId: "9001", label: "Proposal.pdf", status: "held", reason: "original_not_verified" }])
    const captured: unknown = request === undefined ? null : JSON.parse(request.capturedRequestJson)
    expect(record(captured) && record(captured.legacyEvidence) ? captured.legacyEvidence.sourcePayloadJson : null).toBe(raw)
    expect(request?.capturedRequestJson).toContain("Synthetic source note.")
    expect(request).not.toHaveProperty("approvedAt")
  })

  it("rejects payload disagreement, scope disagreement, and bad URL scope", () => {
    const payload = preservedPayload()
    expect(adaptPreservedCapture(payload, serialize({ ...payload, vendor: "Other Vendor" }), scope).success).toBe(false)
    expect(adaptPreservedCapture({ ...payload, projectId: "other-project" }, serialize({ ...payload, projectId: "other-project" }), scope).success).toBe(false)
    expect(adaptPreservedCapture({ ...payload, sourceHref: "https://example.test/request" }, serialize({ ...payload, sourceHref: "https://example.test/request" }), scope).success).toBe(false)
  })

  it("rejects requestEvidence identity and attachment-set drift", () => {
    const payload = preservedPayload()
    const requestEvidence = payload.requestEvidence
    if (!record(requestEvidence)) throw new Error("expected request evidence")
    const badEvidence = { ...payload, requestEvidence: { ...requestEvidence, sourceBidRequestId: "1002" } }
    expect(adaptPreservedCapture(badEvidence, serialize(badEvidence), scope).success).toBe(false)
    const badAttachments = { ...payload, attachmentEvidence: [] }
    expect(adaptPreservedCapture(badAttachments, serialize(badAttachments), scope).success).toBe(false)
  })

  it("allows distinct attachment IDs to reuse a filename", () => {
    const base = preservedPayload()
    if (!record(base.requestEvidence)) throw new Error("expected request evidence")
    const attachments = [
      { fileName: "Proposal.pdf", sourceDocumentInstanceId: "9001" },
      { fileName: "Proposal.pdf", sourceDocumentInstanceId: "9002" },
    ]
    const payload = {
      ...base,
      requestEvidence: { ...base.requestEvidence, attachments },
      attachmentEvidence: attachments,
    }
    const result = adaptPreservedCapture(payload, serialize(payload), scope)
    expect(result.success).toBe(true)
    if (result.success) expect(result.requests[0]?.attachments.map((item) => item.documentInstanceId)).toEqual(["9001", "9002"])
  })

  it("fails closed for unknown schema, status, and line field formats", () => {
    const payload = preservedPayload()
    expect(adaptPreservedCapture({ ...payload, schema: "future-v2" }, serialize({ ...payload, schema: "future-v2" }), scope).success).toBe(false)
    expect(adaptPreservedCapture({ ...payload, status: "Awaiting" }, serialize({ ...payload, status: "Awaiting" }), scope).success).toBe(false)
    const requestEvidence = payload.requestEvidence
    if (!record(requestEvidence) || !Array.isArray(requestEvidence.lines)) throw new Error("expected line fixture")
    const lines = requestEvidence.lines
    const first = lines[0]
    if (!record(first)) throw new Error("expected first line")
    const badLine = { ...payload, requestEvidence: { ...requestEvidence, lines: [{ ...first, builderCostDisplay: 1250 }, ...lines.slice(1)] } }
    expect(adaptPreservedCapture(badLine, serialize(badLine), scope).success).toBe(false)
  })

  it("rejects conflicting release-date aliases", () => {
    const payload = preservedPayload()
    const requestEvidence = payload.requestEvidence
    if (!record(requestEvidence)) throw new Error("expected request evidence")
    const conflicting = {
      ...payload,
      requestEvidence: { ...requestEvidence, releaseDateDisplay: "Aug 1, 2026", releasedDisplay: "Aug 2, 2026" },
    }
    expect(adaptPreservedCapture(conflicting, serialize(conflicting), scope).success).toBe(false)
  })
})
