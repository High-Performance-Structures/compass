import { buildHistoricalRfqRequests, type RfqHistoricalRequest, type RfqHistoricalScope } from "./historical-requests"
import { adaptO152Capture } from "./legacy-source-adapter"
import { adaptPreservedCapture } from "./preserved-source-adapter"

export type HistoricalSourceRow = {
  readonly id: string
  readonly organizationId: string
  readonly projectId: string | null
  readonly requestedProjectId: string | null
  readonly sourceKey: string
  readonly sourceScope: string
  readonly sourceRecordType: string
  readonly buildertrendJobId: string | null
  readonly buildertrendRecordId: string | null
  readonly buildertrendRecordNumber: string | null
  readonly buildertrendUrl: string | null
  readonly rawPayloadJson: string | null
  readonly updatedAt: string
}

/** Caller must fetch this exact row through project/org authorization and an immutable observation join. */
export function historicalRequestFromSource(
  row: HistoricalSourceRow,
  scope: RfqHistoricalScope
): RfqHistoricalRequest | null {
  const requestId = row.buildertrendRecordId
  // Staging primary keys vary by importer; source keys and source identity are
  // authoritative. The caller joins observations and attachments on this real id.
  if (!requestId || !/^[1-9][0-9]*$/.test(requestId) || !row.id.trim() ||
      row.organizationId !== scope.organizationId || row.projectId !== scope.projectId ||
      row.requestedProjectId !== scope.projectId || row.sourceScope !== "job" || row.sourceRecordType !== "rfq_response" ||
      row.buildertrendJobId !== scope.buildertrendJobId || row.buildertrendRecordNumber !== requestId ||
      row.sourceKey !== `job:${scope.buildertrendJobId}:rfq_response:${requestId}` || !row.rawPayloadJson) return null
  try {
    const sourceUrl = new URL(row.buildertrendUrl ?? "")
    if (sourceUrl.protocol !== "https:" || sourceUrl.host !== "buildertrend.net" || sourceUrl.username || sourceUrl.password || sourceUrl.hash ||
        sourceUrl.pathname !== `/app/BidPackages/BidPackage/${scope.bidPackageId}/${scope.buildertrendJobId}/Bid/${requestId}/${scope.buildertrendJobId}/0/0`) return null
    const payload: unknown = JSON.parse(row.rawPayloadJson)
    const modern = buildHistoricalRfqRequests([payload], scope, [])
    // A recognized archive schema must pass its own guards, never a looser fallback.
    const preserved = payload !== null && typeof payload === "object" && "schema" in payload &&
      payload.schema === "buildertrend-rfq-request-preserved-v1"
    const result = preserved ? adaptPreservedCapture(payload, row.rawPayloadJson, scope) :
      modern.success ? modern : adaptO152Capture({ payload, payloadJson: row.rawPayloadJson, sourceRow: {
      id: row.id, organization_id: row.organizationId, project_id: row.projectId,
      requested_project_id: row.requestedProjectId, source_key: row.sourceKey, source_scope: row.sourceScope,
      source_record_type: row.sourceRecordType, buildertrend_job_id: row.buildertrendJobId,
      buildertrend_record_id: requestId, buildertrend_record_number: row.buildertrendRecordNumber,
      buildertrend_url: row.buildertrendUrl, raw_payload_json: row.rawPayloadJson,
    } }, scope, [])
    if (!result.success || result.requests.length !== 1) return null
    const request = result.requests[0]
    if (!request || request.requestId !== requestId) return null
    return request
  } catch { return null }
}
