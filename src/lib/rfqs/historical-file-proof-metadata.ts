import type { RfqHistoricalScope } from "./historical-requests"
import {
  type HistoricalCanonicalFileProof,
  type HistoricalFileExpectation,
  type HistoricalFileViewabilityProof,
  type HistoricalStagedFileRow,
} from "./historical-file-proof"

export type HistoricalFileProofParseResult =
  | { readonly success: true; readonly proof: HistoricalCanonicalFileProof }
  | { readonly success: false; readonly reason: string }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function positiveBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function positivePages(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function parsedJson(value: string | null): Record<string, unknown> | null {
  if (value === null) return null
  try {
    const result: unknown = JSON.parse(value)
    return record(result) ? result : null
  } catch {
    return null
  }
}

function sameRequired(metadata: Record<string, unknown>, key: string, expected: string): boolean {
  return metadata[key] === expected
}

function urlWithoutQueryOrHash(value: unknown, driveFileId: string): boolean {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.host === "drive.google.com" && !url.username && !url.password &&
      url.pathname === `/file/d/${driveFileId}/view` &&
      (url.search === "" || url.search === "?usp=drivesdk") && url.hash === ""
  } catch {
    return false
  }
}

function sourceIdentityReason(
  row: HistoricalStagedFileRow,
  expected: HistoricalFileExpectation,
  scope: RfqHistoricalScope,
): string | null {
  if (row.organization_id !== scope.organizationId || row.project_id !== scope.projectId ||
      row.requested_project_id !== scope.projectId || row.source_scope !== "job" ||
      row.source_record_type !== "rfq_response_attachment" || row.buildertrend_job_id !== scope.buildertrendJobId ||
      !expected.sourceRecordId.trim() || row.source_record_id !== expected.sourceRecordId ||
      row.requested_source_record_key !== `job:${scope.buildertrendJobId}:rfq_response:${expected.requestId}` ||
      row.source_key !== `job:${scope.buildertrendJobId}:rfq_response:${expected.requestId}:attachment:${expected.documentInstanceId}` ||
      !row.id.trim() ||
      row.buildertrend_file_id !== expected.documentInstanceId || row.file_name !== expected.label) {
    return "source_identity_mismatch"
  }
  if (row.file_size === null || !positiveBytes(row.file_size)) return "staged_file_size_missing"
  if (!sha256(row.source_checksum) || row.source_checksum !== row.verified_checksum) return "staged_checksum_missing_or_mismatched"
  if (row.review_status !== "verified" || row.verified_drive_folder_id === null ||
      row.verified_drive_file_id === null || row.verified_drive_url === null) return "staged_verification_metadata_missing"
  return null
}

function viewability(
  metadata: Record<string, unknown>,
  row: HistoricalStagedFileRow,
): HistoricalFileViewabilityProof | null {
  const pages = metadata.pages
  const allPagesViewable = metadata.allPagesViewable
  if (row.mime_type === "application/pdf") {
    return positivePages(pages) && allPagesViewable === true
      ? { kind: "document", pages, allPagesViewable: true } : null
  }
  if (row.mime_type !== null && row.mime_type.startsWith("image/")) {
    return metadata.rendered === true ? { kind: "image", rendered: true } : null
  }
  return null
}

function ancestryMatches(value: unknown, driveFileId: string, directParentId: string, rootId: string): boolean {
  if (!Array.isArray(value) || value.length < 2) return false
  const nodes = value.filter(record)
  if (nodes.length !== value.length) return false
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const ids = nodes.map((node) => text(node.id))
  if (ids.some((id) => id === null) || new Set(ids).size !== ids.length ||
      first.id !== driveFileId || last.id !== rootId || nodes[1].id !== directParentId) return false
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const current = nodes[index]
    const next = nodes[index + 1]
    if (typeof next.id !== "string" || !Array.isArray(current.parents) || current.parents.length === 0 ||
        !current.parents.every((parent): parent is string => typeof parent === "string" && parent.length > 0) ||
        !current.parents.includes(next.id)) return false
  }
  return true
}

function overlayScopeMatches(value: unknown, expected: HistoricalFileExpectation, scope: RfqHistoricalScope): boolean {
  if (!record(value)) return false
  return value.organizationId === scope.organizationId && value.projectId === scope.projectId &&
    value.buildertrendJobId === scope.buildertrendJobId && value.bidPackageId === scope.bidPackageId &&
    value.requestId === expected.requestId
}

function evidenceReferences(value: unknown, receiptSha256: string): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  const references = value.filter(record)
  return references.length === value.length &&
    references.every((item) => text(item.path) !== null && sha256(item.sha256) && text(item.claim) !== null) &&
    references.some((item) => item.receiptSha256 === receiptSha256)
}

function overlayViewability(value: unknown, row: HistoricalStagedFileRow): HistoricalFileViewabilityProof | null {
  if (!record(value)) return null
  if (row.mime_type !== null && row.mime_type.startsWith("image/") && value.kind === "image" && value.rendered === true) {
    const width = value.width
    const height = value.height
    if ((width !== undefined && !positiveBytes(width)) || (height !== undefined && !positiveBytes(height))) return null
    return { kind: "image", rendered: true }
  }
  if (row.mime_type === "application/pdf" && value.kind === "document" &&
      positivePages(value.pages) && value.allPagesViewable === true) {
    return { kind: "document", pages: value.pages, allPagesViewable: true }
  }
  return null
}

/** Strict reader for the additive O-152-compatible proof overlay. */
export function parseHistoricalViewabilityProofOverlay(
  row: HistoricalStagedFileRow,
  expected: HistoricalFileExpectation,
  scope: RfqHistoricalScope,
  overlay: unknown,
): HistoricalFileProofParseResult {
  const identityReason = sourceIdentityReason(row, expected, scope)
  if (identityReason !== null) return { success: false, reason: identityReason }
  if (!record(overlay) || overlay.version !== 1 || !overlayScopeMatches(overlay.scope, expected, scope)) {
    return { success: false, reason: "historical_overlay_scope_or_version_invalid" }
  }
  const sourceSha256 = overlay.sourceSha256
  const destinationSha256 = overlay.destinationSha256
  const sourceBytes = overlay.sourceBytes
  const destinationBytes = overlay.destinationBytes
  const driveFileId = text(overlay.driveFileId)
  const driveUrl = text(overlay.driveUrl)
  const canonicalRootId = text(overlay.canonicalRootId)
  const directParentId = text(overlay.driveImmediateParentId)
  const verifiedDriveFolderId = text(overlay.verifiedDriveFolderId)
  const receiptSha256 = overlay.verificationReceiptSha256
  if (overlay.sourceDocumentInstanceId !== expected.documentInstanceId ||
      !sha256(sourceSha256) || !sha256(destinationSha256) || sourceSha256 !== destinationSha256 ||
      !positiveBytes(sourceBytes) || sourceBytes !== destinationBytes || sourceBytes !== row.file_size ||
      driveFileId === null || driveUrl === null || canonicalRootId !== scope.canonicalDriveRootId ||
      directParentId === null || (verifiedDriveFolderId !== canonicalRootId && verifiedDriveFolderId !== directParentId) ||
      verifiedDriveFolderId !== row.verified_drive_folder_id ||
      !sha256(receiptSha256) || overlay.originalBytesEqual !== true ||
      typeof overlay.recipientAccessVerified !== "boolean" || typeof overlay.sourceRevisionRechecked !== "boolean" ||
      !urlWithoutQueryOrHash(driveUrl, driveFileId) || row.source_checksum !== sourceSha256 ||
      row.verified_checksum !== destinationSha256 || row.verified_drive_file_id !== driveFileId ||
      row.verified_drive_url !== driveUrl || !ancestryMatches(overlay.ancestry, driveFileId, directParentId, canonicalRootId) ||
      !evidenceReferences(overlay.viewabilityEvidence, receiptSha256)) {
    return { success: false, reason: "historical_overlay_identity_or_evidence_invalid" }
  }
  const fileViewability = overlayViewability(overlay.viewability, row)
  if (fileViewability === null) return { success: false, reason: "historical_overlay_viewability_invalid" }
  return {
    success: true,
    proof: {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      buildertrendJobId: scope.buildertrendJobId,
      bidPackageId: scope.bidPackageId,
      canonicalDriveRootId: scope.canonicalDriveRootId,
      requestId: expected.requestId,
      documentInstanceId: expected.documentInstanceId,
      driveFileId,
      driveUrl,
      sourceSha256,
      destinationSha256,
      sourceBytes,
      destinationBytes,
      verificationReceiptSha256: receiptSha256,
      viewability: fileViewability,
    },
  }
}

/**
 * Parses only the persisted staging metadata format used by verified files.
 * It never consults a local proof artifact or fabricates missing viewability.
 */
export function parsePersistedHistoricalFileProof(
  row: HistoricalStagedFileRow,
  expected: HistoricalFileExpectation,
  scope: RfqHistoricalScope,
): HistoricalFileProofParseResult {
  const identityReason = sourceIdentityReason(row, expected, scope)
  if (identityReason !== null) return { success: false, reason: identityReason }
  const source = parsedJson(row.source_metadata_json)
  if (source === null || source.schema !== "buildertrend-rfq-response-attachment-v1") {
    return { success: false, reason: "source_metadata_schema_unrecognized" }
  }
  const sourceIdentity: readonly (readonly [string, string])[] = [
    ["sourceDocumentInstanceId", expected.documentInstanceId],
    ["documentInstanceId", expected.documentInstanceId],
    ["bidId", expected.requestId],
    ["bidPackageId", scope.bidPackageId],
    ["sourceJobId", scope.buildertrendJobId],
    ["sourceParentId", expected.sourceRecordId],
    ["sourceParentKey", `job:${scope.buildertrendJobId}:rfq_response:${expected.requestId}`],
  ]
  if (!sourceIdentity.every(([key, value]) => sameRequired(source, key, value))) {
    return { success: false, reason: "source_metadata_identity_mismatch" }
  }
  if (text(source.canonicalProofArtifact) === null || !sha256(source.canonicalProofSha256)) {
    return { success: false, reason: "source_metadata_proof_reference_missing" }
  }
  const review = parsedJson(row.review_metadata_json)
  if (review === null || review.binding !== "staging-only" || typeof review.recipientAccessVerified !== "boolean") {
    return { success: false, reason: "review_metadata_binding_missing" }
  }
  const canonical = review.canonicalProof
  if (!record(canonical)) return { success: false, reason: "canonical_proof_missing" }
  const driveFileId = text(canonical.driveId)
  const driveUrl = text(canonical.driveUrl)
  const canonicalRootId = text(canonical.canonicalRootId)
  const driveDirectParentId = text(canonical.driveDirectParentId)
  const canonicalSha256 = canonical.sha256
  const bytes = canonical.bytes
  const receiptSha256 = canonical.readbackReceiptSha256
  if (driveFileId === null || driveUrl === null || driveDirectParentId === null || canonicalRootId === null ||
      canonicalRootId !== scope.canonicalDriveRootId || !sha256(canonicalSha256) ||
      !positiveBytes(bytes) || !sha256(receiptSha256) || driveDirectParentId !== row.verified_drive_folder_id ||
      !ancestryMatches(canonical.ancestry, driveFileId, driveDirectParentId, canonicalRootId)) {
    return { success: false, reason: "canonical_proof_identity_or_receipt_missing" }
  }
  if (!urlWithoutQueryOrHash(driveUrl, driveFileId)) return { success: false, reason: "canonical_url_query_or_hash" }
  if (canonical.sourceDocumentInstanceId !== expected.documentInstanceId ||
      (canonical.fileName !== undefined && canonical.fileName !== expected.label) ||
      canonical.originalBytesEqual !== true || typeof canonical.recipientAccessVerified !== "boolean") {
    return { success: false, reason: "canonical_proof_identity_mismatch" }
  }
  if (row.verified_drive_file_id !== driveFileId || row.verified_drive_url !== driveUrl ||
      row.source_checksum !== canonicalSha256 || row.verified_checksum !== canonicalSha256 || row.file_size !== bytes) {
    return { success: false, reason: "canonical_proof_conflicts_with_staged_row" }
  }
  const fileViewability = viewability(canonical, row)
  if (fileViewability === null) return { success: false, reason: "metadata_viewability_missing" }
  return {
    success: true,
    proof: {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      buildertrendJobId: scope.buildertrendJobId,
      bidPackageId: scope.bidPackageId,
      canonicalDriveRootId: scope.canonicalDriveRootId,
      requestId: expected.requestId,
      documentInstanceId: expected.documentInstanceId,
      driveFileId,
      driveUrl,
      sourceSha256: canonicalSha256,
      destinationSha256: canonicalSha256,
      sourceBytes: bytes,
      destinationBytes: bytes,
      verificationReceiptSha256: receiptSha256,
      viewability: fileViewability,
    },
  }
}

/** Runtime-facing nullable wrapper; callers that need diagnostics can use the parser above. */
export function historicalCanonicalFileProofFromRow(
  row: HistoricalStagedFileRow,
  expected: HistoricalFileExpectation,
  scope: RfqHistoricalScope,
): HistoricalCanonicalFileProof | null {
  const review = parsedJson(row.review_metadata_json)
  if (review !== null && Object.hasOwn(review, "historicalViewabilityProof")) {
    const overlayResult = parseHistoricalViewabilityProofOverlay(row, expected, scope, review.historicalViewabilityProof)
    return overlayResult.success ? overlayResult.proof : null
  }
  const result = parsePersistedHistoricalFileProof(row, expected, scope)
  return result.success ? result.proof : null
}
