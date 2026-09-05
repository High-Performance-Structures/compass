import type { HistoricalRfqFileView } from "./historical-workspace"
import type { RfqHistoricalScope } from "./historical-requests"

/** The only staging-file columns needed by the historical reader. */
export type HistoricalStagedFileRow = {
  readonly id: string
  readonly organization_id: string
  readonly source_key: string
  readonly requested_source_record_key: string | null
  readonly source_record_id: string | null
  readonly requested_project_id: string | null
  readonly project_id: string | null
  readonly source_scope: string
  readonly source_record_type: string
  readonly buildertrend_job_id: string | null
  readonly buildertrend_file_id: string | null
  readonly file_name: string
  readonly mime_type: string | null
  readonly file_size: number | null
  readonly verified_drive_folder_id: string | null
  readonly verified_drive_file_id: string | null
  readonly verified_drive_url: string | null
  readonly source_checksum: string | null
  readonly verified_checksum: string | null
  readonly review_status: string
  readonly source_metadata_json: string | null
  readonly review_metadata_json: string | null
}

export type HistoricalFileExpectation = {
  /** Actual authorized staging parent primary key, not a reconstructed source id. */
  readonly sourceRecordId: string
  readonly requestId: string
  readonly documentInstanceId: string
  readonly label: string
}

export type HistoricalFileViewabilityProof =
  | { readonly kind: "document"; readonly pages: number; readonly allPagesViewable: true }
  | { readonly kind: "image"; readonly rendered: true }

/** Canonical proof is supplied from a sealed receipt, not inferred from a URL. */
export type HistoricalCanonicalFileProof = {
  readonly organizationId: string
  readonly projectId: string
  readonly buildertrendJobId: string
  readonly bidPackageId: string
  readonly canonicalDriveRootId: string
  readonly requestId: string
  readonly documentInstanceId: string
  readonly driveFileId: string
  readonly driveUrl: string
  readonly sourceSha256: string
  readonly destinationSha256: string
  readonly sourceBytes: number
  readonly destinationBytes: number
  readonly verificationReceiptSha256: string
  readonly viewability: HistoricalFileViewabilityProof
}

type HeldReason = string

function held(documentInstanceId: string, label: string, reason: HeldReason): HistoricalRfqFileView {
  return { status: "held", documentInstanceId, label, reason }
}

function token(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value)
}

function sha256(value: string | null): value is string {
  return value !== null && /^[a-f0-9]{64}$/.test(value)
}

function positiveBytes(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function metadataMatchesScope(row: HistoricalStagedFileRow, expected: HistoricalFileExpectation, scope: RfqHistoricalScope): boolean {
  if (row.organization_id !== scope.organizationId || row.project_id !== scope.projectId ||
      row.requested_project_id !== scope.projectId || row.source_scope !== "job" ||
      row.source_record_type !== "rfq_response_attachment" || row.buildertrend_job_id !== scope.buildertrendJobId ||
      !expected.sourceRecordId.trim() || row.source_record_id !== expected.sourceRecordId ||
      row.requested_source_record_key !== `job:${scope.buildertrendJobId}:rfq_response:${expected.requestId}` ||
      row.source_key !== `job:${scope.buildertrendJobId}:rfq_response:${expected.requestId}:attachment:${expected.documentInstanceId}` ||
      !row.id.trim() ||
      row.buildertrend_file_id !== expected.documentInstanceId || row.file_name !== expected.label) return false
  try {
    if (row.source_metadata_json === null) return true
    const parsed: unknown = JSON.parse(row.source_metadata_json)
    if (!record(parsed)) return false
    const metadata = parsed
    const identityChecks: readonly [string, string][] = [
      ["sourceDocumentInstanceId", expected.documentInstanceId],
      ["documentInstanceId", expected.documentInstanceId],
      ["bidId", expected.requestId],
      ["bidPackageId", scope.bidPackageId],
      ["sourceJobId", scope.buildertrendJobId],
      ["sourceParentId", expected.sourceRecordId],
      ["sourceParentKey", `job:${scope.buildertrendJobId}:rfq_response:${expected.requestId}`],
    ]
    return identityChecks.every(([key, value]) => {
      const candidate = metadata[key]
      return candidate === undefined || candidate === value
    })
  } catch {
    return false
  }
}

function proofMatchesScope(proof: HistoricalCanonicalFileProof, expected: HistoricalFileExpectation, scope: RfqHistoricalScope): boolean {
  if (proof.organizationId !== scope.organizationId || proof.projectId !== scope.projectId ||
      proof.buildertrendJobId !== scope.buildertrendJobId || proof.bidPackageId !== scope.bidPackageId ||
      proof.canonicalDriveRootId !== scope.canonicalDriveRootId || proof.requestId !== expected.requestId ||
      proof.documentInstanceId !== expected.documentInstanceId || !token(proof.driveFileId) ||
      !sha256(proof.sourceSha256) || proof.sourceSha256 !== proof.destinationSha256 ||
      !sha256(proof.verificationReceiptSha256) || !positiveBytes(proof.sourceBytes) ||
      proof.sourceBytes !== proof.destinationBytes) return false
  try {
    const url = new URL(proof.driveUrl)
    if (url.protocol !== "https:" || url.host !== "drive.google.com" || url.username || url.password ||
        url.pathname !== `/file/d/${proof.driveFileId}/view` ||
        (url.search !== "" && url.search !== "?usp=drivesdk") || url.hash !== "") return false
  } catch {
    return false
  }
  if (proof.viewability.kind === "document") {
    return proof.viewability.allPagesViewable && Number.isSafeInteger(proof.viewability.pages) && proof.viewability.pages > 0
  }
  return proof.viewability.kind === "image" && proof.viewability.rendered
}

/**
 * Maps one immutable source attachment to a workspace-safe view.
 *
 * The caller may pass all rows/proofs returned by its scoped query. The mapper
 * deliberately requires exactly one candidate and one proof for the immutable
 * source ID; filenames and Buildertrend URLs are consistency evidence only.
 */
export function mapHistoricalRfqFile(
  rows: readonly HistoricalStagedFileRow[],
  proofs: readonly HistoricalCanonicalFileProof[],
  expected: HistoricalFileExpectation,
  scope: RfqHistoricalScope,
): HistoricalRfqFileView {
  const idRows = rows.filter((row) => row.buildertrend_file_id === expected.documentInstanceId)
  if (idRows.length === 0) return held(expected.documentInstanceId, expected.label, "missing_candidate")
  const scopedRows = idRows.filter((row) =>
    row.organization_id === scope.organizationId && row.project_id === scope.projectId &&
    row.requested_project_id === scope.projectId && row.buildertrend_job_id === scope.buildertrendJobId &&
    row.source_record_id === expected.sourceRecordId &&
    row.requested_source_record_key === `job:${scope.buildertrendJobId}:rfq_response:${expected.requestId}`)
  if (scopedRows.length === 0) return held(expected.documentInstanceId, expected.label, "source_identity_mismatch")
  if (scopedRows.length > 1) return held(expected.documentInstanceId, expected.label, "duplicate_candidate_file_id")
  const row = scopedRows[0]
  if (!metadataMatchesScope(row, expected, scope)) return held(expected.documentInstanceId, expected.label, "source_identity_mismatch")
  if (row.review_status !== "verified" || row.verified_drive_folder_id === null || row.file_size === null || !positiveBytes(row.file_size) ||
      row.verified_drive_file_id === null || row.verified_drive_url === null ||
      !sha256(row.source_checksum) || row.source_checksum !== row.verified_checksum) {
    return held(expected.documentInstanceId, expected.label, "staged_file_proof_missing")
  }
  const matchingProofs = proofs.filter((proof) => proof.documentInstanceId === expected.documentInstanceId)
  if (matchingProofs.length === 0) return held(expected.documentInstanceId, expected.label, "canonical_file_proof_missing")
  if (matchingProofs.length > 1) return held(expected.documentInstanceId, expected.label, "conflicting_canonical_file_proof")
  const proof = matchingProofs[0]
  if (!proofMatchesScope(proof, expected, scope) || proof.driveFileId !== row.verified_drive_file_id ||
      proof.sourceSha256 !== row.source_checksum || proof.sourceBytes !== row.file_size ||
      (row.mime_type === null ? true : row.mime_type.startsWith("image/")
        ? proof.viewability.kind !== "image" : row.mime_type === "application/pdf"
          ? proof.viewability.kind !== "document" : true)) {
    return held(expected.documentInstanceId, expected.label, "canonical_file_proof_conflict")
  }
  if (row.verified_drive_url !== proof.driveUrl) return held(expected.documentInstanceId, expected.label, "canonical_url_conflict")
  return { status: "verified", documentInstanceId: expected.documentInstanceId, label: expected.label, url: proof.driveUrl }
}
