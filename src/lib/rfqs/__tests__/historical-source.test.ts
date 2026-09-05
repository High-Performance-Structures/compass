import { describe, expect, it } from "vitest"

import {
  historicalRequestFromSource,
  type HistoricalSourceRow,
} from "@/lib/rfqs/historical-source"
import type { RfqHistoricalScope } from "@/lib/rfqs/historical-requests"

const scope: RfqHistoricalScope = {
  organizationId: "org-test",
  projectId: "project-test",
  buildertrendJobId: "7001",
  bidPackageId: "8001",
  canonicalDriveRootId: "drive-root-test",
}

const sourceUrl = "https://buildertrend.net/app/BidPackages/BidPackage/8001/7001/Bid/1001/7001/0/0"

function serialize(value: unknown): string {
  const result = JSON.stringify(value)
  if (result === undefined) throw new Error("fixture must be serializable")
  return result
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function modernPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "bt-rfq-response-1001",
    sourceKey: "job:7001:rfq_response:1001",
    project: { projectId: "project-test", buildertrendJobId: "7001", bidPackageId: "8001" },
    source: { sourceBidRequestId: "1001", sourceHref: sourceUrl },
    vendor: { displayName: "Generic Vendor", legacyParticipantEvidence: { submittedBy: "Historical Submitter" } },
    status: {
      sourceStatus: "Submitted", submitted: true, pricedSubmission: true,
      releaseDateDisplay: "2026-08-01", submittedDisplay: "2026-08-04 11:30 AM", timezone: null,
    },
    financial: {
      amountDisplay: "$1,250.00", totalDisplay: "$1,250.00", derivedMoney: false,
      lines: [
        { title: "Service panel", description: "Panel and breakers", expandedDescription: "Panel, breakers, and labels", costCode: "26-100", costType: "Material", unitCostDisplay: "$800.00", quantityDisplay: "1", unitDisplay: "LS", builderCostDisplay: "$800.00" },
        { title: "Installation", description: "Install service panel", expandedDescription: null, costCode: "26-200", costType: "Labor", unitCostDisplay: "$450.00", quantityDisplay: "1", unitDisplay: "LS", builderCostDisplay: "$450.00" },
      ],
    },
    attachments: [],
    notes: { notesFromVendorDisplay: "Synthetic source note." },
    sourceAudit: { importBatch: "synthetic-test-capture" },
    ...overrides,
  }
}

function legacyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provenance: "synthetic legacy source capture", sourceArtifact: "synthetic-legacy.json",
    projectNumber: "G-001", projectId: "project-test", buildertrendJobId: "7001",
    bidPackageId: "8001", bidId: "1001", vendor: "Generic Vendor", status: "Submitted",
    submittedAt: "2026-08-04", bidAmount: 1250, sourceHref: sourceUrl,
    responseEvidence: {
      bidId: "1001", vendor: "Generic Vendor", submittedBy: "Historical Submitter",
      notes: "Synthetic legacy note.",
      lineItems: [
        { description: "Service panel", unitCost: "800.00", quantity: "1.0000", builderCost: "800.00" },
        { description: "Installation", unitCost: "450.00", quantity: "1.0000", builderCost: "450.00" },
      ],
      total: "1250.00", attachments: [], attachmentDocumentInstanceIds: {}, detailSourceHref: sourceUrl,
    },
    attachmentEvidence: [], ...overrides,
  }
}

function sourceRow(payload: unknown, overrides: Partial<HistoricalSourceRow> = {}): HistoricalSourceRow {
  return {
    id: "bt-rfq-response-1001", organizationId: "org-test", projectId: "project-test",
    requestedProjectId: "project-test", sourceKey: "job:7001:rfq_response:1001", sourceScope: "job",
    sourceRecordType: "rfq_response", buildertrendJobId: "7001", buildertrendRecordId: "1001",
    buildertrendRecordNumber: "1001", buildertrendUrl: sourceUrl, rawPayloadJson: serialize(payload),
    updatedAt: "2026-08-05T12:00:00.000Z", ...overrides,
  }
}

function requestFrom(payload: unknown, overrides: Partial<HistoricalSourceRow> = {}) {
  return historicalRequestFromSource(sourceRow(payload, overrides), scope)
}

describe("historical RFQ source reconstruction", () => {
  it("uses source identity rather than a staging primary-key naming convention", () => {
    const id = "buildertrend:source:org-test:job:7001:rfq_response:1001"
    expect(requestFrom(modernPayload(), { id })?.requestId).toBe("1001")
    expect(requestFrom(legacyPayload(), { id })?.requestId).toBe("1001")
    expect(requestFrom(modernPayload(), { id, buildertrendRecordId: "1002" })).toBeNull()
    expect(requestFrom(legacyPayload(), { id, sourceKey: "job:7001:rfq_response:1002" })).toBeNull()
  })

  it("accepts modern and legacy captures with exact scope, money, lines, and raw provenance", () => {
    const modernPayloadValue = modernPayload()
    const modern = requestFrom(modernPayloadValue)
    const legacyPayloadValue = legacyPayload()
    const legacy = requestFrom(legacyPayloadValue)

    expect(modern).toMatchObject({
      historicalKey: JSON.stringify(["org-test", "project-test", "7001", "8001", "1001"]),
      submittedAmountCents: 125_000, amountDisplayProvenance: "captured",
      sourceStatus: "Submitted", submission: "submitted",
    })
    expect(legacy).toMatchObject({ submittedAmountCents: 125_000, amountDisplayProvenance: "derived" })
    expect(modern?.scope).toEqual(scope)
    expect(modern?.capturedRequestJson).toBe(serialize(modernPayloadValue))
    expect(legacy?.capturedRequestJson).toContain(`\"sourcePayloadJson\":${JSON.stringify(serialize(legacyPayloadValue))}`)
    expect(modern?.releasedDisplay).toBe("2026-08-01")
    expect(modern?.submittedDisplay).toBe("2026-08-04 11:30 AM")
    expect(modern?.lines).toHaveLength(2)
  })

  it("retains draft and unpriced responses without inventing actors or timestamps", () => {
    const draft = requestFrom(modernPayload({
      status: { sourceStatus: "Draft", submitted: false, pricedSubmission: false, releaseDateDisplay: "2026-08-01", submittedDisplay: null, timezone: null },
      financial: { amountDisplay: "$0.00", totalDisplay: "$0.00", derivedMoney: false, lines: [] },
    }))
    const unpriced = requestFrom(modernPayload({
      status: { sourceStatus: "Submitted", submitted: true, pricedSubmission: false, releaseDateDisplay: "Source calendar date", submittedDisplay: "Source display date", timezone: "not exposed" },
      financial: { amountDisplay: null, totalDisplay: null, derivedMoney: false, lines: [] },
    }))

    expect(draft).toMatchObject({ submission: "draft", pricingReconciliation: "unpriced", submittedAmountCents: null })
    expect(unpriced).toMatchObject({ submission: "submitted", pricingReconciliation: "unpriced", submittedAmountCents: null })
    expect(unpriced?.submittedDisplay).toBe("Source display date")
    expect(unpriced).not.toHaveProperty("submittedAt")
    expect(unpriced).not.toHaveProperty("approvedByUserId")
    expect(unpriced).not.toHaveProperty("sourceSubmittedByDisplay")
  })

  it.each([
    ["empty row id", { id: "" }], ["organization", { organizationId: "other-org" }],
    ["project", { projectId: "other-project" }], ["requested project", { requestedProjectId: "other-project" }],
    ["source key", { sourceKey: "job:other:rfq_response:1001" }], ["source scope", { sourceScope: "project" }],
    ["source record type", { sourceRecordType: "bid" }], ["job", { buildertrendJobId: "7002" }],
    ["record number", { buildertrendRecordNumber: "9999" }],
  ])("rejects source-row identity drift: %s", (_, overrides) => {
    expect(requestFrom(modernPayload(), overrides)).toBeNull()
  })

  it("rejects payload identity disagreement with the exact source row", () => {
    expect(requestFrom(modernPayload({ project: { projectId: "other-project", buildertrendJobId: "7001", bidPackageId: "8001" } }))).toBeNull()
    expect(requestFrom(modernPayload({ id: "bt-rfq-response-1002", sourceKey: "job:7001:rfq_response:1002", source: { sourceBidRequestId: "1002", sourceHref: sourceUrl } }))).toBeNull()
  })

  it.each([
    "https://buildertrend.net/app/BidPackages/BidPackage/8002/7001/Bid/1001/7001/0/0",
    "https://buildertrend.net/app/BidPackages/BidPackage/8001/7001/Bid/1002/7001/0/0",
    "https://buildertrend.net/app/BidPackages/BidPackage/8001/7002/Bid/1001/7002/0/0",
    "https://example.test/app/BidPackages/BidPackage/8001/7001/Bid/1001/7001/0/0",
    "https://user@buildertrend.net/app/BidPackages/BidPackage/8001/7001/Bid/1001/7001/0/0",
    `${sourceUrl}#other-record`,
    "not-a-url",
    null,
  ])("rejects modern captured URL drift independently of the valid staging URL: %s", sourceHref => {
    expect(requestFrom(modernPayload({ source: { sourceBidRequestId: "1001", sourceHref } }))).toBeNull()
  })

  it.each([
    ["wrong host", "https://example.test/app/BidPackages/BidPackage/8001/7001/Bid/1001/7001/0/0"],
    ["wrong package", "https://buildertrend.net/app/BidPackages/BidPackage/9001/7001/Bid/1001/7001/0/0"],
    ["wrong job", "https://buildertrend.net/app/BidPackages/BidPackage/8001/7002/Bid/1001/7002/0/0"],
    ["wrong request", "https://buildertrend.net/app/BidPackages/BidPackage/8001/7001/Bid/1002/7001/0/0"],
    ["credentials", "https://user:pass@buildertrend.net/app/BidPackages/BidPackage/8001/7001/Bid/1001/7001/0/0"],
  ])("rejects bad source URL: %s", (_, buildertrendUrl) => {
    expect(requestFrom(modernPayload(), { buildertrendUrl })).toBeNull()
  })

  it("rejects malformed raw JSON, amount drift, and line-total drift", () => {
    expect(requestFrom(modernPayload(), { rawPayloadJson: "not-json" })).toBeNull()
    expect(requestFrom(modernPayload({ financial: { amountDisplay: "$1,251.00", totalDisplay: "$1,251.00", derivedMoney: false, lines: [
      { title: "Service panel", description: "Panel and breakers", builderCostDisplay: "$800.00" },
      { title: "Installation", description: "Install service panel", builderCostDisplay: "$450.00" },
    ] } }))).toBeNull()
    expect(requestFrom(modernPayload({ financial: { amountDisplay: "$1,250.00", totalDisplay: "$1,250.00", derivedMoney: false, lines: [
      { title: "Service panel", builderCostDisplay: "$700.00" },
      { title: "Installation", builderCostDisplay: "$450.00" },
    ] } }))).toBeNull()
  })

  it("preserves recognized vendor notes without making them approval or identity fields", () => {
    const request = requestFrom(modernPayload())
    expect(request).not.toBeNull()
    const captured: unknown = request === null ? null : JSON.parse(request.capturedRequestJson)
    expect(record(captured) && record(captured.notes) ? captured.notes.notesFromVendorDisplay : null).toBe("Synthetic source note.")
    expect(request).not.toHaveProperty("approvedByUserId")
    expect(request).not.toHaveProperty("approvedAt")
  })
})
