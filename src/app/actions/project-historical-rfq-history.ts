"use server"

import { and, asc, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { getDb } from "@/db"
import { projectOperations, projects } from "@/db/schema"
import { buildertrendArchiveFiles, buildertrendSourceRecords } from "@/db/schema-buildertrend"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"
import { historicalRequestFromSource, type HistoricalSourceRow } from "@/lib/rfqs/historical-source"
import type { RfqHistoricalScope } from "@/lib/rfqs/historical-requests"
import type { HistoricalRfqWorkspace, HistoricalRfqWorkspaceItem } from "@/lib/rfqs/historical-workspace"
import { mapHistoricalRfqFile } from "@/lib/rfqs/historical-file-proof"
import { historicalCanonicalFileProofFromRow } from "@/lib/rfqs/historical-file-proof-metadata"
import { historicalSubmitterDisplay, historicalVendorNotes } from "@/lib/rfqs/historical-display"

const PAGE_SIZE = 50

function sourceScope(
  row: HistoricalSourceRow,
  project: { readonly id: string; readonly jobId: string | null; readonly rootId: string | null },
  organizationId: string,
): RfqHistoricalScope | null {
  if (!project.jobId || !project.rootId || !row.buildertrendUrl) return null
  try {
    const url = new URL(row.buildertrendUrl)
    const route = url.pathname.match(/^\/app\/BidPackages\/BidPackage\/([1-9][0-9]*)\/([1-9][0-9]*)\/Bid\/([1-9][0-9]*)\/([1-9][0-9]*)\/0\/0$/)
    if (url.protocol !== "https:" || url.host !== "buildertrend.net" || url.username || url.password || url.hash ||
        !route || route[2] !== project.jobId || route[4] !== project.jobId || route[3] !== row.buildertrendRecordId) return null
    const bidPackageId = route[1]
    if (!bidPackageId) return null
    return { organizationId, projectId: project.id, buildertrendJobId: project.jobId,
      bidPackageId, canonicalDriveRootId: project.rootId }
  } catch { return null }
}

/** Internal history only. Never reuse this list for an owner/vendor portal response. */
export async function getProjectHistoricalRfqWorkspace(
  projectId: string,
  cursor: string | null = null,
): Promise<HistoricalRfqWorkspace> {
  try {
    const user = await requireAuth()
    if (!user.isActive || isDemoUser(user.id) || user.organizationType !== "internal" || !isInternalStaffRole(user.role)) {
      return { success: false, error: "Historical vendor bids are available only to authorized internal staff." }
    }
    await requireFeaturePermission(user, "rfqs", "read")
    const organizationId = requireOrg(user)
    if (cursor !== null && (typeof cursor !== "string" || !cursor || cursor.length > 512)) {
      return { success: false, error: "Invalid history page. Return to the first page." }
    }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await assertProjectAccess(db, user, projectId)
    const project = await db.select({ id: projects.id, jobId: projects.buildertrendProjectId, rootId: projects.googleDriveFolderId })
      .from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1).get()
    if (!project) return { success: false, error: "Project history is not available." }
    const records = alias(buildertrendSourceRecords, "history_records")
    // Unpromoted recoveries belong in this project's hold list when their exact
    // requested project matches. Never pull another project's rows by job alone.
    const scopeWhere = and(eq(records.organizationId, organizationId),
      or(eq(records.projectId, projectId),
        and(isNull(records.projectId), eq(records.requestedProjectId, projectId))),
      eq(records.sourceRecordType, "rfq_response"))
    // Exact evidence may be raw, a standard importer manifest, or a sealed row
    // envelope. Compare identity and payload in each proven format, never just id.
    // The correlated join returns one observation, not duplicate request cards.
    // Missing observations remain visible as holds; an inner join would silently hide them.
    const [totals, candidates] = await db.batch([
      db.select({ count: count() }).from(records).where(scopeWhere),
      db.select({
        id: records.id, organizationId: records.organizationId, projectId: records.projectId,
        requestedProjectId: records.requestedProjectId, sourceKey: records.sourceKey, sourceScope: records.sourceScope,
        sourceRecordType: records.sourceRecordType, buildertrendJobId: records.buildertrendJobId,
        buildertrendRecordId: records.buildertrendRecordId, buildertrendRecordNumber: records.buildertrendRecordNumber,
        buildertrendUrl: records.buildertrendUrl, rawPayloadJson: records.rawPayloadJson, updatedAt: records.updatedAt,
        // Explicit qualification is intentional: Drizzle strips column table names
        // from interpolated SQL selection fields, breaking correlated references.
        observationId: sql<string | null>`(SELECT evidence.id FROM buildertrend_staging_observations evidence
          WHERE evidence.organization_id = history_records.organization_id
            AND evidence.entity_kind = 'record' AND evidence.entity_id = history_records.id
            AND (
              (evidence.entity_key IN (history_records.source_key, 'record:' || history_records.source_key || ':response')
                AND evidence.observed_payload_json = history_records.raw_payload_json)
              OR (evidence.entity_key = history_records.source_key AND
                CASE WHEN json_valid(evidence.observed_payload_json) AND json_valid(history_records.raw_payload_json) THEN
                  json_extract(evidence.observed_payload_json, '$.sourceKey') = history_records.source_key
                  AND json_extract(evidence.observed_payload_json, '$.projectId') = history_records.requested_project_id
                  AND json_extract(evidence.observed_payload_json, '$.sourceScope') = history_records.source_scope
                  AND json_extract(evidence.observed_payload_json, '$.sourceRecordType') = history_records.source_record_type
                  AND json_extract(evidence.observed_payload_json, '$.buildertrendJobId') = history_records.buildertrend_job_id
                  AND json_extract(evidence.observed_payload_json, '$.buildertrendRecordId') = history_records.buildertrend_record_id
                  AND json_extract(evidence.observed_payload_json, '$.buildertrendRecordNumber') = history_records.buildertrend_record_number
                  AND json_extract(evidence.observed_payload_json, '$.buildertrendUrl') = history_records.buildertrend_url
                  AND json_type(evidence.observed_payload_json, '$.rawPayload') = 'object'
                  AND json_extract(evidence.observed_payload_json, '$.rawPayload') = json(history_records.raw_payload_json)
                ELSE 0 END)
              OR (evidence.entity_key = history_records.source_key AND
                CASE WHEN json_valid(evidence.observed_payload_json) THEN
                  json_type(evidence.observed_payload_json, '$.row') = 'object'
                  AND json_type(evidence.observed_payload_json, '$.evidence') = 'array'
                  AND json_array_length(evidence.observed_payload_json, '$.evidence') > 0
                  AND json_extract(evidence.observed_payload_json, '$.observationSemantics') =
                    'Frozen canonical migration observation assembled now; historical dates remain separate source fields.'
                  AND json_extract(evidence.observed_payload_json, '$.row.id') = history_records.id
                  AND json_extract(evidence.observed_payload_json, '$.row.organization_id') = history_records.organization_id
                  AND json_extract(evidence.observed_payload_json, '$.row.source_key') = history_records.source_key
                  AND json_extract(evidence.observed_payload_json, '$.row.project_id') = history_records.project_id
                  AND json_extract(evidence.observed_payload_json, '$.row.requested_project_id') = history_records.requested_project_id
                  AND json_extract(evidence.observed_payload_json, '$.row.source_scope') = history_records.source_scope
                  AND json_extract(evidence.observed_payload_json, '$.row.source_record_type') = history_records.source_record_type
                  AND json_extract(evidence.observed_payload_json, '$.row.buildertrend_job_id') = history_records.buildertrend_job_id
                  AND json_extract(evidence.observed_payload_json, '$.row.buildertrend_record_id') = history_records.buildertrend_record_id
                  AND json_extract(evidence.observed_payload_json, '$.row.buildertrend_record_number') = history_records.buildertrend_record_number
                  AND json_extract(evidence.observed_payload_json, '$.row.buildertrend_url') = history_records.buildertrend_url
                  AND json_extract(evidence.observed_payload_json, '$.row.raw_payload_json') = history_records.raw_payload_json
                ELSE 0 END)
            )
          ORDER BY evidence.observed_at DESC, evidence.id DESC LIMIT 1)`,
      }).from(records).where(and(scopeWhere, cursor === null ? undefined : gt(records.id, cursor)))
        .orderBy(asc(records.id)).limit(PAGE_SIZE + 1),
    ])
    const page = candidates.slice(0, PAGE_SIZE)
    const parsed = page.map(row => {
      const scope = sourceScope(row, project, organizationId)
      return { row, scope, request: scope && row.observationId ? historicalRequestFromSource(row, scope) : null }
    })
    const packages = [...new Set(parsed.flatMap(item => item.request ? [item.request.scope.bidPackageId] : []))]
    const operations = packages.length === 0 ? [] : await db.select({ id: projectOperations.id, packageId: projectOperations.sourceRecordId })
      .from(projectOperations).where(and(eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceSystem, "buildertrend"), eq(projectOperations.sourceRecordType, "rfq"),
        inArray(projectOperations.sourceRecordId, packages)))
    const parentsWithFiles = parsed.flatMap(({ row, request }) => request?.attachments.length ? [row.id] : [])
    const files = buildertrendArchiveFiles
    const stagedFiles = parentsWithFiles.length === 0 ? [] : await db.select({
      id: files.id, organization_id: files.organizationId, source_key: files.sourceKey,
      requested_source_record_key: files.requestedSourceRecordKey, source_record_id: files.sourceRecordId,
      requested_project_id: files.requestedProjectId, project_id: files.projectId,
      source_scope: files.sourceScope, source_record_type: files.sourceRecordType,
      buildertrend_job_id: files.buildertrendJobId, buildertrend_file_id: files.buildertrendFileId,
      file_name: files.fileName, mime_type: files.mimeType, file_size: files.fileSize,
      verified_drive_folder_id: files.verifiedDriveFolderId, verified_drive_file_id: files.verifiedDriveFileId,
      verified_drive_url: files.verifiedDriveUrl, source_checksum: files.sourceChecksum,
      verified_checksum: files.verifiedChecksum, review_status: files.reviewStatus,
      source_metadata_json: files.sourceMetadataJson, review_metadata_json: files.reviewMetadataJson,
    }).from(files).where(and(eq(files.organizationId, organizationId), eq(files.projectId, projectId),
      inArray(files.sourceRecordId, parentsWithFiles)))
    const items: HistoricalRfqWorkspaceItem[] = parsed.map(({ row, scope, request }) => {
      if (!row.observationId) return { kind: "held", sourceRecordId: row.id, bidPackageId: scope?.bidPackageId ?? null, reason: "Matching immutable source evidence is not available." }
      if (!scope) return { kind: "held", sourceRecordId: row.id, bidPackageId: null, reason: "Project, source package or canonical folder identity needs reconciliation." }
      if (!request) return { kind: "held", sourceRecordId: row.id, bidPackageId: scope.bidPackageId, reason: "This source format or its identity/pricing evidence needs reconciliation. The archived record is retained." }
      const matches = operations.filter(operation => operation.packageId === scope.bidPackageId)
      const operationId = matches.length === 1 ? matches[0]?.id ?? null : null
      const holds: string[] = []
      if (matches.length === 0) holds.push("Historical RFQ package is not yet linked to an operational Compass RFQ.")
      if (matches.length > 1) holds.push("Multiple operational RFQ matches require reconciliation.")
      if (request.pricingReconciliation === "incomplete") holds.push("Captured prices are incomplete; approval is unavailable.")
      return {
        kind: "request", sourceRecordId: row.id, requestId: request.requestId, bidPackageId: scope.bidPackageId,
        operationId, vendorDisplay: request.vendorDisplay, sourceStatus: request.sourceStatus,
        submission: request.submission, pricingReconciliation: request.pricingReconciliation,
        sourceAmountDisplay: request.sourceAmountDisplay, submittedAmountCents: request.submittedAmountCents,
        amountDisplayProvenance: request.amountDisplayProvenance, releasedDisplay: request.releasedDisplay,
        submittedDisplay: request.submittedDisplay, lines: request.lines, holds,
        submittedByDisplay: historicalSubmitterDisplay(JSON.parse(request.capturedRequestJson)),
        vendorNotes: historicalVendorNotes(JSON.parse(request.capturedRequestJson)),
        attachments: request.attachments.map(file => {
          const expected = { sourceRecordId: row.id, requestId: request.requestId, documentInstanceId: file.documentInstanceId, label: file.label }
          const requestFiles = stagedFiles.filter(candidate => candidate.source_record_id === row.id)
          const proofs = requestFiles.flatMap(candidate => {
            const proof = historicalCanonicalFileProofFromRow(candidate, expected, scope)
            return proof ? [proof] : []
          })
          return mapHistoricalRfqFile(requestFiles, proofs, expected, scope)
        }),
      }
    })
    return { success: true, projectId, totalRecords: totals[0]?.count ?? 0, items,
      nextCursor: candidates.length > PAGE_SIZE ? page.at(-1)?.id ?? null : null,
      hasPreviousPage: cursor !== null }
  } catch {
    return { success: false, error: "Historical RFQ data could not be loaded. This is not an empty-history result." }
  }
}
