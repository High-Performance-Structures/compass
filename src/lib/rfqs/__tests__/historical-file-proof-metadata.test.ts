import { describe, expect, it } from "vitest"

import {
  historicalCanonicalFileProofFromRow,
  parsePersistedHistoricalFileProof,
} from "../historical-file-proof-metadata"
import type { HistoricalStagedFileRow } from "../historical-file-proof"

const scope = {
  organizationId: "org-test",
  projectId: "project-test",
  buildertrendJobId: "7001",
  bidPackageId: "8001",
  canonicalDriveRootId: "drive-root-test",
} satisfies {
  readonly organizationId: string
  readonly projectId: string
  readonly buildertrendJobId: string
  readonly bidPackageId: string
  readonly canonicalDriveRootId: string
}

const expected = {
  sourceRecordId: "bt-rfq-response-1001",
  requestId: "1001",
  documentInstanceId: "4001",
  label: "proposal.pdf",
} satisfies {
  readonly sourceRecordId: string
  readonly requestId: string
  readonly documentInstanceId: string
  readonly label: string
}

const sourceMetadata = {
  schema: "buildertrend-rfq-response-attachment-v1",
  sourceDocumentInstanceId: expected.documentInstanceId,
  documentInstanceId: expected.documentInstanceId,
  bidId: expected.requestId,
  bidPackageId: scope.bidPackageId,
  sourceJobId: scope.buildertrendJobId,
  sourceParentId: "bt-rfq-response-1001",
  sourceParentKey: "job:7001:rfq_response:1001",
  canonicalProofArtifact: "canonical-proof.json",
  canonicalProofSha256: "c".repeat(64),
}

const canonicalProof = {
  sourceDocumentInstanceId: expected.documentInstanceId,
  fileName: expected.label,
  bytes: 12,
  sha256: "a".repeat(64),
  pages: 1,
  driveId: "drive-file-4001",
  driveUrl: "https://drive.google.com/file/d/drive-file-4001/view?usp=drivesdk",
  driveDirectParentId: "drive-parent-test",
  canonicalRootId: scope.canonicalDriveRootId,
  ancestry: [
    { id: "drive-file-4001", parents: ["drive-parent-test"] },
    { id: "drive-parent-test", parents: [scope.canonicalDriveRootId] },
    { id: scope.canonicalDriveRootId, parents: [] },
  ],
  readbackReceiptSha256: "b".repeat(64),
  originalBytesEqual: true,
  allPagesViewable: true,
  recipientAccessVerified: false,
}

const row: HistoricalStagedFileRow = {
  id: "bt-rfq-response-file-1001-4001",
  organization_id: scope.organizationId,
  source_key: "job:7001:rfq_response:1001:attachment:4001",
  requested_source_record_key: "job:7001:rfq_response:1001",
  source_record_id: "bt-rfq-response-1001",
  requested_project_id: scope.projectId,
  project_id: scope.projectId,
  source_scope: "job",
  source_record_type: "rfq_response_attachment",
  buildertrend_job_id: scope.buildertrendJobId,
  buildertrend_file_id: expected.documentInstanceId,
  file_name: expected.label,
  mime_type: "application/pdf",
  file_size: 12,
  verified_drive_folder_id: "drive-parent-test",
  verified_drive_file_id: "drive-file-4001",
  verified_drive_url: canonicalProof.driveUrl,
  source_checksum: canonicalProof.sha256,
  verified_checksum: canonicalProof.sha256,
  review_status: "verified",
  source_metadata_json: JSON.stringify(sourceMetadata),
  review_metadata_json: JSON.stringify({ binding: "staging-only", canonicalProof, recipientAccessVerified: false }),
}

const legacySourceMetadataJson = JSON.stringify({ sourceArtifact: "legacy-capture.json", bidId: expected.requestId, documentInstanceId: expected.documentInstanceId })
const overlay = {
  version: 1,
  scope: {
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    buildertrendJobId: scope.buildertrendJobId,
    bidPackageId: scope.bidPackageId,
    requestId: expected.requestId,
  },
  sourceDocumentInstanceId: expected.documentInstanceId,
  sourceSha256: canonicalProof.sha256,
  destinationSha256: canonicalProof.sha256,
  sourceBytes: canonicalProof.bytes,
  destinationBytes: canonicalProof.bytes,
  verificationReceiptSha256: canonicalProof.readbackReceiptSha256,
  driveFileId: canonicalProof.driveId,
  driveUrl: canonicalProof.driveUrl,
  verifiedDriveFolderId: "drive-parent-test",
  canonicalRootId: scope.canonicalDriveRootId,
  driveImmediateParentId: "drive-parent-test",
  ancestry: canonicalProof.ancestry,
  originalBytesEqual: true,
  recipientAccessVerified: false,
  sourceRevisionRechecked: false,
  viewability: { kind: "document", pages: 1, allPagesViewable: true },
  viewabilityEvidence: [{ path: "proof.json", sha256: "c".repeat(64), claim: "rendered page reviewed", receiptSha256: canonicalProof.readbackReceiptSha256 }],
}

describe("persisted historical file proof parser", () => {
  it("accepts importer-assigned primary keys but requires the exact authorized parent", () => {
    const sourceRecordId = "buildertrend:source:org-test:job:7001:rfq_response:1001"
    const importerRow = { ...row,
      id: "buildertrend:file:org-test:job:7001:rfq_response:1001:attachment:4001",
      source_record_id: sourceRecordId,
      source_metadata_json: JSON.stringify({ ...sourceMetadata, sourceParentId: sourceRecordId }),
    }
    const importerExpected = { ...expected, sourceRecordId }
    expect(parsePersistedHistoricalFileProof(importerRow, importerExpected, scope).success).toBe(true)
    expect(parsePersistedHistoricalFileProof(importerRow, expected, scope).success).toBe(false)
    expect(parsePersistedHistoricalFileProof({ ...importerRow, source_metadata_json: row.source_metadata_json }, importerExpected, scope).success).toBe(false)
    expect(parsePersistedHistoricalFileProof({ ...importerRow, id: "" }, importerExpected, scope).success).toBe(false)
  })

  it("derives an exact proof from recognized staged metadata", () => {
    const result = parsePersistedHistoricalFileProof(row, expected, scope)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.proof).toMatchObject({
      documentInstanceId: expected.documentInstanceId,
      driveFileId: "drive-file-4001",
      driveUrl: canonicalProof.driveUrl,
      sourceBytes: 12,
      destinationBytes: 12,
      viewability: { kind: "document", pages: 1, allPagesViewable: true },
    })
    expect(historicalCanonicalFileProofFromRow(row, expected, scope)).toEqual(result.proof)
  })

  it.each([
    ["unrecognized source schema", { source_metadata_json: JSON.stringify({ ...sourceMetadata, schema: "other" }) }, "source_metadata_schema_unrecognized"],
    ["missing required source identity", { source_metadata_json: JSON.stringify({ ...sourceMetadata, bidPackageId: undefined }) }, "source_metadata_identity_mismatch"],
    ["unrecognized binding", { review_metadata_json: JSON.stringify({ binding: "other", canonicalProof }) }, "review_metadata_binding_missing"],
    ["missing receipt", { review_metadata_json: JSON.stringify({ binding: "staging-only", canonicalProof: { ...canonicalProof, readbackReceiptSha256: null }, recipientAccessVerified: false }) }, "canonical_proof_identity_or_receipt_missing"],
    ["missing viewability", { review_metadata_json: JSON.stringify({ binding: "staging-only", canonicalProof: { ...canonicalProof, allPagesViewable: false }, recipientAccessVerified: false }) }, "metadata_viewability_missing"],
    ["broken ancestry", { review_metadata_json: JSON.stringify({ binding: "staging-only", canonicalProof: { ...canonicalProof, ancestry: [canonicalProof.ancestry[0], canonicalProof.ancestry[2]] }, recipientAccessVerified: false }) }, "canonical_proof_identity_or_receipt_missing"],
    ["arbitrary URL query", { review_metadata_json: JSON.stringify({ binding: "staging-only", canonicalProof: { ...canonicalProof, driveUrl: `${canonicalProof.driveUrl}&download=1` }, recipientAccessVerified: false }) }, "canonical_url_query_or_hash"],
    ["missing staged bytes", { file_size: null }, "staged_file_size_missing"],
  ])("returns a precise hold for %s", (_, overrides, reason) => {
    const candidate: HistoricalStagedFileRow = { ...row, ...overrides }
    expect(parsePersistedHistoricalFileProof(candidate, expected, scope)).toEqual({ success: false, reason })
    expect(historicalCanonicalFileProofFromRow(candidate, expected, scope)).toBeNull()
  })

  it("keeps image proof fail-closed without an explicit rendered viewability field", () => {
    const imageRow: HistoricalStagedFileRow = { ...row, mime_type: "image/jpeg", file_name: "Kitchen.jpg" }
    const imageExpected = { ...expected, label: "Kitchen.jpg" }
    const imageProof = { ...canonicalProof, fileName: "Kitchen.jpg", pages: null, allPagesViewable: null }
    const candidate: HistoricalStagedFileRow = { ...imageRow, review_metadata_json: JSON.stringify({ binding: "staging-only", canonicalProof: imageProof, recipientAccessVerified: false }) }
    expect(parsePersistedHistoricalFileProof(candidate, imageExpected, scope)).toEqual({ success: false, reason: "metadata_viewability_missing" })
  })

  it("does not treat a recipient-access flag as permission evidence", () => {
    const candidate: HistoricalStagedFileRow = {
      ...row,
      review_metadata_json: JSON.stringify({
        binding: "staging-only",
        canonicalProof: { ...canonicalProof, recipientAccessVerified: true },
        recipientAccessVerified: true,
      }),
    }
    expect(historicalCanonicalFileProofFromRow(candidate, expected, scope)).not.toBeNull()
  })

  it("accepts the additive overlay without requiring legacy metadata rewrites", () => {
    const legacyReviewMetadataJson = JSON.stringify({
      binding: { id: "legacy-binding", sourceProofSha256: "d".repeat(64) },
      historicalViewabilityProof: overlay,
    })
    const candidate: HistoricalStagedFileRow = {
      ...row,
      source_metadata_json: legacySourceMetadataJson,
      review_metadata_json: legacyReviewMetadataJson,
    }
    expect(historicalCanonicalFileProofFromRow(candidate, expected, scope)).toMatchObject({
      documentInstanceId: expected.documentInstanceId,
      sourceBytes: canonicalProof.bytes,
      driveFileId: canonicalProof.driveId,
    })
    expect(candidate.source_metadata_json).toBe(legacySourceMetadataJson)
    expect(candidate.review_metadata_json).toBe(legacyReviewMetadataJson)
  })

  it("fails closed when an overlay key is present, even if legacy proof data is also present", () => {
    const candidate: HistoricalStagedFileRow = {
      ...row,
      source_metadata_json: legacySourceMetadataJson,
      review_metadata_json: JSON.stringify({
        binding: "staging-only",
        canonicalProof,
        historicalViewabilityProof: { ...overlay, sourceBytes: 13 },
        recipientAccessVerified: false,
      }),
    }
    expect(historicalCanonicalFileProofFromRow(candidate, expected, scope)).toBeNull()
  })

  it.each([
    ["version", { version: 2 }],
    ["scope", { scope: { ...overlay.scope, projectId: "other-project" } }],
    ["source ID", { sourceDocumentInstanceId: "4999" }],
    ["source hash", { sourceSha256: "d".repeat(64) }],
    ["destination hash", { destinationSha256: "d".repeat(64) }],
    ["bytes", { sourceBytes: 13, destinationBytes: 13 }],
    ["Drive ID", { driveFileId: "other-drive" }],
    ["Drive URL", { driveUrl: "https://drive.google.com/file/d/drive-file-4001/view?download=1" }],
    ["root", { canonicalRootId: "other-root" }],
    ["verified folder", { verifiedDriveFolderId: "other-parent" }],
    ["direct parent", { driveImmediateParentId: "other-parent" }],
    ["ancestry", { ancestry: [{ id: "drive-file-4001", parents: ["drive-parent-test"] }, { id: "drive-parent-test", parents: ["drive-file-4001"] }, { id: scope.canonicalDriveRootId, parents: [] }] }],
    ["receipt", { verificationReceiptSha256: "d".repeat(64) }],
    ["original equality", { originalBytesEqual: false }],
    ["viewability", { viewability: { kind: "document", pages: 0, allPagesViewable: true } }],
    ["evidence hash", { viewabilityEvidence: [{ path: "proof.json", sha256: "bad", claim: "rendered page reviewed" }] }],
  ])("holds overlay mutation: %s", (_, mutation) => {
    const candidate: HistoricalStagedFileRow = {
      ...row,
      source_metadata_json: legacySourceMetadataJson,
      review_metadata_json: JSON.stringify({ historicalViewabilityProof: { ...overlay, ...mutation }}),
    }
    expect(historicalCanonicalFileProofFromRow(candidate, expected, scope)).toBeNull()
  })

  it("requires image overlays to carry explicit image viewability", () => {
    const imageRow: HistoricalStagedFileRow = { ...row, mime_type: "image/jpeg", file_name: "image.jpg" }
    const imageExpected = { ...expected, label: "image.jpg" }
    const imageOverlay = { ...overlay, scope: { ...overlay.scope }, viewability: { kind: "document", pages: 1, allPagesViewable: true } }
    const candidate: HistoricalStagedFileRow = {
      ...imageRow,
      source_metadata_json: legacySourceMetadataJson,
      review_metadata_json: JSON.stringify({ historicalViewabilityProof: imageOverlay }),
    }
    expect(historicalCanonicalFileProofFromRow(candidate, imageExpected, scope)).toBeNull()
  })

  it("rejects an unsupported or mismatched staged MIME type", () => {
    const candidate: HistoricalStagedFileRow = {
      ...row,
      mime_type: "text/plain",
      source_metadata_json: legacySourceMetadataJson,
      review_metadata_json: JSON.stringify({ historicalViewabilityProof: overlay }),
    }
    expect(historicalCanonicalFileProofFromRow(candidate, expected, scope)).toBeNull()
  })
})
