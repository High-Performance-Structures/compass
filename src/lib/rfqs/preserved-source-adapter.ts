import {
  buildHistoricalRfqRequests,
  type RfqHistoricalResult,
  type RfqHistoricalScope,
} from "./historical-requests"

type JsonRecord = Record<string, unknown>

export type PreservedSourceResult = RfqHistoricalResult

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function array(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameJson(item, right[index]))
  }
  if (record(left) && record(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
      key === rightKeys[index] && sameJson(left[key], right[key]))
  }
  return false
}

function decimalId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value)
}

function sourceHrefMatchesScope(value: unknown, scope: RfqHistoricalScope, requestId: string): boolean {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    const path = `/app/BidPackages/BidPackage/${scope.bidPackageId}/${scope.buildertrendJobId}/Bid/${requestId}/${scope.buildertrendJobId}/0/0`
    return url.protocol === "https:" && url.host === "buildertrend.net" &&
      url.username === "" && url.password === "" && url.hash === "" && url.pathname === path
  } catch {
    return false
  }
}

function optionalString(value: JsonRecord, key: string, errors: string[], context: string): string | null {
  if (!(key in value)) return null
  const result = value[key]
  if (result === null) return null
  if (typeof result !== "string") {
    errors.push(`invalid_string:${context}.${key}`)
    return null
  }
  return result
}

function requiredString(value: JsonRecord, key: string, errors: string[], context: string): string | null {
  const result = optionalString(value, key, errors, context)
  if (result === null) errors.push(`missing_string:${context}.${key}`)
  return result
}

function requiredBoolean(value: JsonRecord, key: string, errors: string[], context: string): boolean | null {
  if (!(key in value) || typeof value[key] !== "boolean") {
    errors.push(`missing_boolean:${context}.${key}`)
    return null
  }
  return value[key] === true
}

function lineValues(value: unknown, errors: string[]): readonly JsonRecord[] {
  const lines = array(value)
  if (lines === null) {
    errors.push("request_evidence_lines_not_array")
    return []
  }
  const output: JsonRecord[] = []
  for (const [index, lineValue] of lines.entries()) {
    if (!record(lineValue)) {
      errors.push(`invalid_line:${index}`)
      continue
    }
    const context = `requestEvidence.lines[${index}]`
    const title = requiredString(lineValue, "title", errors, context)
    optionalString(lineValue, "description", errors, context)
    optionalString(lineValue, "expandedDescription", errors, context)
    const costCode = optionalString(lineValue, "costCode", errors, context)
    const costCodeDisplay = optionalString(lineValue, "costCodeDisplay", errors, context)
    const costType = optionalString(lineValue, "costType", errors, context)
    const costTypeDisplay = optionalString(lineValue, "costTypeDisplay", errors, context)
    optionalString(lineValue, "unitCostDisplay", errors, context)
    optionalString(lineValue, "quantityDisplay", errors, context)
    optionalString(lineValue, "unitDisplay", errors, context)
    optionalString(lineValue, "builderCostDisplay", errors, context)
    // Preserve recognized display aliases at this adapter boundary; the original
    // capture remains intact in sourcePayloadJson for provenance.
    if (title !== null) output.push({ ...lineValue, costCode: costCode ?? costCodeDisplay, costType: costType ?? costTypeDisplay })
  }
  return output
}

function attachments(
  requestEvidence: JsonRecord,
  payload: JsonRecord,
  errors: string[],
): readonly JsonRecord[] {
  const listed = array(requestEvidence.attachments)
  const evidence = array(payload.attachmentEvidence)
  if (listed === null || evidence === null) {
    errors.push("attachment_evidence_not_array")
    return []
  }
  const listedById = new Map<string, JsonRecord>()
  for (const [index, value] of listed.entries()) {
    if (!record(value)) {
      errors.push(`invalid_attachment:${index}`)
      continue
    }
    const fileName = requiredString(value, "fileName", errors, `requestEvidence.attachments[${index}]`)
    const documentInstanceId = requiredString(value, "sourceDocumentInstanceId", errors, `requestEvidence.attachments[${index}]`)
    if (fileName === null || documentInstanceId === null || !decimalId(documentInstanceId) ||
        listedById.has(documentInstanceId)) {
      errors.push(`invalid_or_duplicate_attachment:${index}`)
      continue
    }
    listedById.set(documentInstanceId, value)
  }
  const evidenceById = new Map<string, JsonRecord>()
  for (const [index, value] of evidence.entries()) {
    if (!record(value)) {
      errors.push(`invalid_attachment_evidence:${index}`)
      continue
    }
    const fileName = requiredString(value, "fileName", errors, `attachmentEvidence[${index}]`)
    const documentInstanceId = requiredString(value, "sourceDocumentInstanceId", errors, `attachmentEvidence[${index}]`)
    if (fileName === null || documentInstanceId === null || !decimalId(documentInstanceId) ||
        evidenceById.has(documentInstanceId)) {
      errors.push(`invalid_or_duplicate_attachment_evidence:${index}`)
      continue
    }
    evidenceById.set(documentInstanceId, value)
  }
  if (listedById.size !== evidenceById.size ||
      [...listedById.keys()].some((id) => !evidenceById.has(id)) ||
      [...evidenceById.keys()].some((id) => !listedById.has(id))) {
    errors.push("attachment_id_set_mismatch")
  }
  const output: JsonRecord[] = []
  for (const [documentInstanceId, listedValue] of listedById) {
    const evidenceValue = evidenceById.get(documentInstanceId)
    const listedFileName = text(listedValue.fileName)
    const evidenceFileName = evidenceValue === undefined ? null : text(evidenceValue.fileName)
    const listedId = text(listedValue.sourceDocumentInstanceId)
    const evidenceId = evidenceValue === undefined ? null : text(evidenceValue.sourceDocumentInstanceId)
    if (evidenceValue === undefined || listedFileName === null || evidenceFileName === null ||
        listedFileName !== evidenceFileName || listedId === null || evidenceId === null ||
        listedId !== evidenceId || listedId !== documentInstanceId) {
      errors.push(`attachment_identity_mismatch:${documentInstanceId}`)
      continue
    }
    output.push({ sourceDocumentInstanceId: listedId, sourceFileId: listedId, fileName: listedFileName })
  }
  return output
}

function buildNormalized(payload: JsonRecord, scope: RfqHistoricalScope, errors: string[]): JsonRecord | null {
  if (payload.schema !== "buildertrend-rfq-request-preserved-v1") {
    errors.push("unsupported_preserved_source_schema")
    return null
  }
  const projectId = requiredString(payload, "projectId", errors, "payload")
  const buildertrendJobId = requiredString(payload, "buildertrendJobId", errors, "payload")
  const bidPackageId = requiredString(payload, "bidPackageId", errors, "payload")
  const requestId = requiredString(payload, "bidId", errors, "payload")
  const vendor = requiredString(payload, "vendor", errors, "payload")
  const status = requiredString(payload, "status", errors, "payload")
  const sourceHref = requiredString(payload, "sourceHref", errors, "payload")
  const sourceArtifact = requiredString(payload, "sourceArtifact", errors, "payload")
  const sourceArtifactSha256 = requiredString(payload, "sourceArtifactSha256", errors, "payload")
  const parentRfqRecordId = requiredString(payload, "parentRfqRecordId", errors, "payload")
  const parentRfqSourceKey = requiredString(payload, "parentRfqSourceKey", errors, "payload")
  const recordDateSemantics = requiredString(payload, "recordDateSemantics", errors, "payload")
  const sourceFieldsArePreserved = requiredBoolean(payload, "sourceFieldsArePreserved", errors, "payload")
  const recipientAccessVerified = requiredBoolean(payload, "recipientAccessVerified", errors, "payload")
  const importedAs = requiredString(payload, "importedAs", errors, "payload")
  const requestEvidence = record(payload.requestEvidence) ? payload.requestEvidence : null
  if (requestEvidence === null) errors.push("request_evidence_not_object")
  if (projectId === null || buildertrendJobId === null || bidPackageId === null || requestId === null ||
      vendor === null || status === null || sourceHref === null || sourceArtifact === null ||
      sourceArtifactSha256 === null || parentRfqRecordId === null || parentRfqSourceKey === null ||
      recordDateSemantics === null || sourceFieldsArePreserved === null ||
      recipientAccessVerified === null || importedAs === null || requestEvidence === null) return null
  if (!scope.projectId || projectId !== scope.projectId || buildertrendJobId !== scope.buildertrendJobId ||
      bidPackageId !== scope.bidPackageId || !decimalId(requestId) || status !== "Draft" && status !== "Submitted" ||
      !/^[a-f0-9]{64}$/.test(sourceArtifactSha256) || sourceFieldsArePreserved !== true ||
      recipientAccessVerified !== false || !sourceHrefMatchesScope(sourceHref, scope, requestId) ||
      parentRfqRecordId !== `bt-module-rfq-${buildertrendJobId}-${bidPackageId}` ||
      parentRfqSourceKey !== `rfq:${buildertrendJobId}:${bidPackageId}`) {
    errors.push("preserved_source_scope_or_provenance_mismatch")
    return null
  }
  const evidenceId = requiredString(requestEvidence, "sourceBidRequestId", errors, "requestEvidence")
  const evidenceHref = requiredString(requestEvidence, "sourceHref", errors, "requestEvidence")
  const evidenceVendor = requiredString(requestEvidence, "vendorDisplay", errors, "requestEvidence")
  const evidenceStatus = requiredString(requestEvidence, "status", errors, "requestEvidence")
  const amountDisplay = requiredString(requestEvidence, "amountDisplay", errors, "requestEvidence")
  const totalDisplay = optionalString(requestEvidence, "totalDisplay", errors, "requestEvidence")
  const pricedSubmission = requiredBoolean(requestEvidence, "pricedSubmission", errors, "requestEvidence")
  const lines = lineValues(requestEvidence.lines, errors)
  const attachmentValues = attachments(requestEvidence, payload, errors)
  if (evidenceId === null || evidenceHref === null || evidenceVendor === null || evidenceStatus === null ||
      amountDisplay === null || pricedSubmission === null) return null
  if (evidenceId !== requestId || evidenceHref !== sourceHref || !sourceHrefMatchesScope(evidenceHref, scope, requestId) ||
      evidenceVendor !== vendor || evidenceStatus !== status ||
      (status === "Draft" && pricedSubmission !== false)) {
    errors.push("preserved_source_request_evidence_mismatch")
    return null
  }
  const releaseDateDisplay = optionalString(requestEvidence, "releaseDateDisplay", errors, "requestEvidence")
  const releasedDisplay = optionalString(requestEvidence, "releasedDisplay", errors, "requestEvidence")
  if (releaseDateDisplay !== null && releasedDisplay !== null && releaseDateDisplay !== releasedDisplay) {
    errors.push("release_date_alias_mismatch")
  }
  const submittedDisplay = optionalString(requestEvidence, "submittedDisplay", errors, "requestEvidence")
  const timezoneRaw = requestEvidence.timezone
  const timezone = timezoneRaw === undefined || timezoneRaw === null || typeof timezoneRaw === "string" || record(timezoneRaw)
    ? typeof timezoneRaw === "string" ? timezoneRaw : null
    : null
  if (timezoneRaw !== undefined && timezoneRaw !== null && typeof timezoneRaw !== "string" && !record(timezoneRaw)) {
    errors.push("invalid_timezone_format")
  }
  if (errors.length > 0) return null
  const notes = record(requestEvidence.notes) ? requestEvidence.notes : null
  const notesFromVendorDisplay = notes === null ? null : optionalString(notes, "notesFromVendorDisplay", errors, "requestEvidence.notes")
  if (errors.length > 0) return null
  const legacyEvidence: JsonRecord = {
    adapter: "buildertrend-rfq-request-preserved-v1",
    sourcePayloadJson: "",
    sourceArtifact,
    sourceArtifactSha256,
    parentRfqRecordId,
    parentRfqSourceKey,
    recordDateSemantics,
    sourceHref,
    sourceStatus: status,
    sourceRequestEvidence: requestEvidence,
    sourceTimezone: timezoneRaw ?? null,
    sourcePackageEvidence: payload.sourcePackageEvidence ?? null,
    sourceFields: payload.sourceFieldsArePreserved,
    recipientAccessVerified,
    importedAs,
  }
  const normalized: JsonRecord = {
    id: `bt-rfq-response-${requestId}`,
    sourceKey: `job:${scope.buildertrendJobId}:rfq_response:${requestId}`,
    project: { projectId: scope.projectId, buildertrendJobId: scope.buildertrendJobId, bidPackageId: scope.bidPackageId },
    source: { sourceBidRequestId: requestId, sourceHref, sourceArtifact, sourceArtifactSha256 },
    vendor: { displayName: vendor },
    status: {
      sourceStatus: status,
      submitted: status === "Submitted",
      // Submission and pricing are independent source facts; an unpriced
      // submitted response must retain its vendor, notes and attachments.
      pricedSubmission,
      releaseDateDisplay: releaseDateDisplay ?? releasedDisplay,
      submittedDisplay,
      timezone,
    },
    financial: {
      amountDisplay,
      totalDisplay,
      derivedMoney: false,
      lines,
    },
    attachments: attachmentValues,
    notes: notesFromVendorDisplay === null ? undefined : { notesFromVendorDisplay },
    legacyEvidence,
  }
  return normalized
}

/** Converts preserved-v1 Buildertrend request captures without dropping raw provenance. */
export function adaptPreservedCapture(
  payload: unknown,
  payloadJson: string,
  scope: RfqHistoricalScope,
): PreservedSourceResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadJson)
  } catch {
    return { success: false, errors: ["preserved_source_payload_json_invalid"] }
  }
  if (!record(parsed) || !record(payload) || !sameJson(parsed, payload)) {
    return { success: false, errors: ["preserved_source_payload_disagreement"] }
  }
  const errors: string[] = []
  const normalized = buildNormalized(parsed, scope, errors)
  if (normalized === null || errors.length > 0) return { success: false, errors }
  const evidence = normalized.legacyEvidence
  if (!record(evidence)) return { success: false, errors: ["preserved_source_legacy_evidence_missing"] }
  const withRawEvidence: JsonRecord = {
    ...normalized,
    legacyEvidence: { ...evidence, sourcePayloadJson: payloadJson },
  }
  return buildHistoricalRfqRequests([withRawEvidence], scope, [])
}
