import { describe, expect, it } from "vitest"

import {
  mapHistoricalRfqFile,
  type HistoricalCanonicalFileProof,
  type HistoricalStagedFileRow,
} from "../historical-file-proof"

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
  verified_drive_url: "https://drive.google.com/file/d/drive-file-4001/view",
  source_checksum: "a".repeat(64),
  verified_checksum: "a".repeat(64),
  review_status: "verified",
  source_metadata_json: JSON.stringify({
    sourceDocumentInstanceId: expected.documentInstanceId,
    documentInstanceId: expected.documentInstanceId,
    bidId: expected.requestId,
    bidPackageId: scope.bidPackageId,
    sourceJobId: scope.buildertrendJobId,
    sourceParentId: "bt-rfq-response-1001",
    sourceParentKey: "job:7001:rfq_response:1001",
  }),
  review_metadata_json: null,
}

const proof: HistoricalCanonicalFileProof = {
  organizationId: scope.organizationId,
  projectId: scope.projectId,
  buildertrendJobId: scope.buildertrendJobId,
  bidPackageId: scope.bidPackageId,
  canonicalDriveRootId: scope.canonicalDriveRootId,
  requestId: expected.requestId,
  documentInstanceId: expected.documentInstanceId,
  driveFileId: "drive-file-4001",
  driveUrl: "https://drive.google.com/file/d/drive-file-4001/view",
  sourceSha256: "a".repeat(64),
  destinationSha256: "a".repeat(64),
  sourceBytes: 12,
  destinationBytes: 12,
  verificationReceiptSha256: "b".repeat(64),
  viewability: { kind: "document", pages: 1, allPagesViewable: true },
}

describe("historical RFQ file proof mapper", () => {
  it("maps importer-assigned file ids only under their actual parent foreign key", () => {
    const sourceRecordId = "buildertrend:source:org-test:job:7001:rfq_response:1001"
    const importerRow = { ...row,
      id: "buildertrend:file:org-test:job:7001:rfq_response:1001:attachment:4001",
      source_record_id: sourceRecordId,
      source_metadata_json: JSON.stringify({ sourceParentId: sourceRecordId }),
    }
    expect(mapHistoricalRfqFile([importerRow], [proof], { ...expected, sourceRecordId }, scope).status).toBe("verified")
    expect(mapHistoricalRfqFile([importerRow], [proof], expected, scope).status).toBe("held")
    expect(mapHistoricalRfqFile([{ ...importerRow, source_key: "wrong-key" }], [proof], { ...expected, sourceRecordId }, scope).status).toBe("held")
  })

  it("returns a verified canonical Drive view only for one exact candidate and proof", () => {
    expect(mapHistoricalRfqFile([row], [proof], expected, scope)).toEqual({
      status: "verified",
      documentInstanceId: expected.documentInstanceId,
      label: expected.label,
      url: proof.driveUrl,
    })
  })

  it.each([
    ["missing candidate", [], [proof], "missing_candidate"],
    ["missing proof", [row], [], "canonical_file_proof_missing"],
    ["duplicate candidate ID", [row, row], [proof], "duplicate_candidate_file_id"],
    ["duplicate proof ID", [row], [proof, proof], "conflicting_canonical_file_proof"],
  ])("holds for %s", (_, rows, proofs, reason) => {
    expect(mapHistoricalRfqFile(rows, proofs, expected, scope)).toEqual({
      status: "held",
      documentInstanceId: expected.documentInstanceId,
      label: expected.label,
      reason,
    })
  })

  it("does not use a filename or source identity as the immutable key", () => {
    const wrongId = { ...row, buildertrend_file_id: "4999" }
    const wrongName = { ...row, file_name: "renamed.pdf" }
    expect(mapHistoricalRfqFile([wrongId], [proof], expected, scope)).toMatchObject({ reason: "missing_candidate" })
    expect(mapHistoricalRfqFile([wrongName], [proof], expected, scope)).toMatchObject({ reason: "source_identity_mismatch" })
  })

  it("holds scope, checksum, bytes, canonical URL, and viewability drift", () => {
    expect(mapHistoricalRfqFile([{ ...row, project_id: "other-project" }], [proof], expected, scope)).toMatchObject({ reason: "source_identity_mismatch" })
    expect(mapHistoricalRfqFile([row], [{ ...proof, destinationSha256: "c".repeat(64) }], expected, scope)).toMatchObject({ reason: "canonical_file_proof_conflict" })
    expect(mapHistoricalRfqFile([row], [{ ...proof, sourceBytes: 13, destinationBytes: 13 }], expected, scope)).toMatchObject({ reason: "canonical_file_proof_conflict" })
    expect(mapHistoricalRfqFile([row], [{ ...proof, driveUrl: "https://drive.google.com/file/d/other/view" }], expected, scope)).toMatchObject({ reason: "canonical_file_proof_conflict" })
    expect(mapHistoricalRfqFile([row], [{ ...proof, driveUrl: `${proof.driveUrl}?unexpected=1` }], expected, scope)).toMatchObject({ reason: "canonical_file_proof_conflict" })
    expect(mapHistoricalRfqFile([row], [{ ...proof, viewability: { kind: "document", pages: 0, allPagesViewable: true } }], expected, scope)).toMatchObject({ reason: "canonical_file_proof_conflict" })
  })

  it("accepts explicit image rendering evidence without treating filenames as proof", () => {
    const imageRow: HistoricalStagedFileRow = { ...row, file_name: "Kitchen.jpg", mime_type: "image/jpeg", file_size: 10 }
    const imageExpected = { ...expected, label: "Kitchen.jpg" }
    const imageProof: HistoricalCanonicalFileProof = { ...proof, sourceBytes: 10, destinationBytes: 10, viewability: { kind: "image", rendered: true } }
    expect(mapHistoricalRfqFile([imageRow], [imageProof], imageExpected, scope)).toMatchObject({ status: "verified", label: "Kitchen.jpg" })
  })

  it("holds an image when the proof lacks explicit image viewability", () => {
    const imageRow: HistoricalStagedFileRow = { ...row, file_name: "Kitchen.jpg", mime_type: "image/jpeg" }
    const imageExpected = { ...expected, label: "Kitchen.jpg" }
    expect(mapHistoricalRfqFile([imageRow], [proof], imageExpected, scope)).toMatchObject({ reason: "canonical_file_proof_conflict" })
  })
})
