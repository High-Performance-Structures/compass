import {
  buildHistoricalRfqRequests,
  type RfqFileProof,
  type RfqHistoricalRequest,
  type RfqHistoricalResult,
  type RfqHistoricalScope,
} from "./historical-requests"

export type O152MoneyDerivation = {
  readonly requestId: string
  readonly sourceBidAmount: number
  readonly sourceTotalPlainDecimal: string
  readonly sourceLineBuilderCostPlainDecimals: readonly string[]
  readonly derivedAmountDisplay: string
  readonly derivedAmountCents: number
}

export type O152Capture = {
  readonly payload: unknown
  readonly payloadJson: string
  readonly sourceRow?: Record<string, unknown>
}

export type O152CaptureResult =
  | { readonly success: true; readonly capture: O152Capture }
  | { readonly success: false; readonly errors: readonly string[] }

export type O152AdapterResult =
  | {
      readonly success: true
      readonly requests: readonly RfqHistoricalRequest[]
      readonly moneyDerivations: readonly O152MoneyDerivation[]
    }
  | {
      readonly success: false
      readonly errors: readonly string[]
      readonly moneyDerivations: readonly O152MoneyDerivation[]
    }

type JsonRecord = Record<string, unknown>

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function array(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null
}

function decimalCents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null
  const parts = value.split(".")
  const whole = Number(parts[0])
  const fraction = Number((parts[1] ?? "").padEnd(2, "0"))
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) return null
  const result = whole * 100 + fraction
  return Number.isSafeInteger(result) ? result : null
}

function numberToCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
  const source = String(value)
  return decimalCents(source)
}

function moneyDisplay(cents: number): string {
  const whole = Math.floor(cents / 100).toLocaleString("en-US")
  const fraction = String(cents % 100).padStart(2, "0")
  return `$${whole}.${fraction}`
}

function sourceHrefMatchesScope(
  value: unknown,
  scope: RfqHistoricalScope,
  requestId: string,
): boolean {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    const expectedPath = `/app/BidPackages/BidPackage/${scope.bidPackageId}/${scope.buildertrendJobId}/Bid/${requestId}/${scope.buildertrendJobId}/0/0`
    return url.protocol === "https:" && url.host === "buildertrend.net" && url.username === "" && url.password === "" && url.hash === "" && url.pathname === expectedPath
  } catch {
    return false
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameJson(item, right[index]))
  }
  if (record(left) && record(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]))
  }
  return false
}

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return daysInMonth !== undefined && day <= daysInMonth
}

function pathValue(value: unknown, keys: readonly string[]): unknown {
  let current = value
  for (const key of keys) {
    if (!record(current)) return undefined
    current = current[key]
  }
  return current
}

function extractRawResponseRows(receipt: unknown): readonly JsonRecord[] | null {
  const rawReceipts = pathValue(receipt, ["rawReceipts"])
  if (!Array.isArray(rawReceipts)) return null
  const parentReceipts = rawReceipts.filter((item) =>
    record(item) && item.name === "exact_parent_rfq_response_select_star"
  )
  if (parentReceipts.length !== 1) return null
  const rawResponse = pathValue(parentReceipts[0], ["rawResponse"])
  if (!Array.isArray(rawResponse) || rawResponse.length !== 1) return null
  const responseEnvelope = rawResponse[0]
  const results = pathValue(responseEnvelope, ["results"])
  if (!Array.isArray(results)) return null
  if (!results.every(record)) return null
  return results
}

/** Extracts the exact raw_payload_json string from the sealed local SELECT receipt. */
export function extractO152CaptureFromReceipt(receipt: unknown): O152CaptureResult {
  const rows = extractRawResponseRows(receipt)
  if (rows === null || rows.length !== 1) {
    return { success: false, errors: ["o152_parent_response_row_missing_or_ambiguous"] }
  }
  const row = rows[0]
  if (row === undefined) return { success: false, errors: ["o152_parent_response_row_missing_or_ambiguous"] }
  const payloadJson = row.raw_payload_json
  if (typeof payloadJson !== "string" || payloadJson.length === 0) {
    return { success: false, errors: ["o152_raw_payload_json_missing"] }
  }
  try {
    const payload: unknown = JSON.parse(payloadJson)
    if (!record(payload)) return { success: false, errors: ["o152_raw_payload_not_object"] }
    return { success: true, capture: { payload, payloadJson, sourceRow: row } }
  } catch {
    return { success: false, errors: ["o152_raw_payload_json_invalid"] }
  }
}

function attachmentEvidence(
  payload: JsonRecord,
  requestId: string,
  errors: string[],
): readonly JsonRecord[] {
  const responseEvidence = payload.responseEvidence
  if (!record(responseEvidence)) {
    errors.push(`missing_response_evidence:${requestId}`)
    return []
  }
  const names = array(responseEvidence.attachments)
  const idMap = responseEvidence.attachmentDocumentInstanceIds
  const evidence = array(payload.attachmentEvidence)
  if (names === null || !record(idMap) || evidence === null) {
    errors.push(`attachment_evidence_shape:${requestId}`)
    return []
  }
  const evidenceByName = new Map<string, JsonRecord>()
  for (const item of evidence) {
    if (!record(item)) {
      errors.push(`attachment_evidence_item_shape:${requestId}`)
      continue
    }
    const fileName = text(item.fileName)
    if (fileName === null || evidenceByName.has(fileName)) {
      errors.push(`attachment_evidence_duplicate_or_missing_name:${requestId}`)
      continue
    }
    evidenceByName.set(fileName, item)
  }
  const expectedNames = new Set<string>()
  for (const nameValue of names) {
    const fileName = text(nameValue)
    if (fileName !== null) expectedNames.add(fileName)
  }
  const mappedNames = Object.keys(idMap)
  if (mappedNames.length !== expectedNames.size || mappedNames.some((name) => !expectedNames.has(name))) {
    errors.push(`attachment_id_map_name_set_mismatch:${requestId}`)
  }
  const evidenceNames = [...evidenceByName.keys()]
  if (evidenceNames.length !== expectedNames.size || evidenceNames.some((name) => !expectedNames.has(name))) {
    errors.push(`attachment_evidence_name_set_mismatch:${requestId}`)
  }
  const output: JsonRecord[] = []
  const seenIds = new Set<string>()
  for (const nameValue of names) {
    const fileName = text(nameValue)
    const sourceId = fileName === null ? null : text(idMap[fileName])
    const item = fileName === null ? undefined : evidenceByName.get(fileName)
    const evidenceId = item === undefined ? null : text(item.documentInstanceId)
    if (fileName === null || sourceId === null || item === undefined || evidenceId === null || sourceId !== evidenceId || seenIds.has(sourceId)) {
      errors.push(`attachment_name_id_evidence_mismatch:${requestId}`)
      continue
    }
    seenIds.add(sourceId)
    output.push({
      sourceDocumentInstanceId: sourceId,
      sourceFileId: sourceId,
      fileName,
      viewerRoute: item.viewerRoute ?? null,
      viewerPages: item.viewerPages ?? null,
    })
  }
  if (evidenceByName.size !== expectedNames.size) errors.push(`attachment_evidence_count_mismatch:${requestId}`)
  return output
}

function lineItems(
  payload: JsonRecord,
  requestId: string,
  errors: string[],
): { readonly lines: readonly JsonRecord[]; readonly lineDecimals: readonly string[] } {
  const responseEvidence = payload.responseEvidence
  const rawLines = record(responseEvidence) ? array(responseEvidence.lineItems) : null
  if (rawLines === null) {
    errors.push(`line_items_missing:${requestId}`)
    return { lines: [], lineDecimals: [] }
  }
  const lines: JsonRecord[] = []
  const lineDecimals: string[] = []
  for (const [index, value] of rawLines.entries()) {
    if (!record(value)) {
      errors.push(`line_item_shape:${requestId}:${index}`)
      continue
    }
    const description = text(value.description)
    const builderCost = text(value.builderCost)
    const unitCost = text(value.unitCost)
    if (description === null || builderCost === null || unitCost === null || decimalCents(builderCost) === null || decimalCents(unitCost) === null) {
      errors.push(`line_item_money_or_description_invalid:${requestId}:${index}`)
      continue
    }
    lineDecimals.push(builderCost)
    lines.push({
      title: description,
      description,
      expandedDescription: null,
      costCode: null,
      costType: null,
      unitCostDisplay: moneyDisplay(decimalCents(unitCost) ?? 0),
      quantityDisplay: text(value.quantity),
      unitDisplay: null,
      builderCostDisplay: moneyDisplay(decimalCents(builderCost) ?? 0),
      legacyUnitCostPlainDecimal: unitCost,
      legacyBuilderCostPlainDecimal: builderCost,
    })
  }
  return { lines, lineDecimals }
}

function makeNormalizedRequest(
  payload: JsonRecord,
  capture: O152Capture,
  scope: RfqHistoricalScope,
  errors: string[],
): { readonly normalized: JsonRecord | null; readonly derivation: O152MoneyDerivation | null } {
  const responseEvidence = payload.responseEvidence
  if (!record(responseEvidence)) {
    errors.push("missing_response_evidence:unknown")
    return { normalized: null, derivation: null }
  }
  const requestId = text(payload.bidId)
  const nestedBidId = text(responseEvidence.bidId)
  const vendor = text(payload.vendor)
  const nestedVendor = text(responseEvidence.vendor)
  const sourceStatus = text(payload.status)
  const submittedAt = text(payload.submittedAt)
  const sourceHref = text(payload.sourceHref)
  const projectId = text(payload.projectId)
  const buildertrendJobId = text(payload.buildertrendJobId)
  const bidPackageId = text(payload.bidPackageId)
  const sourceBidAmount = payload.bidAmount
  if (requestId === null || nestedBidId === null || requestId !== nestedBidId || vendor === null || nestedVendor === null || vendor !== nestedVendor || sourceStatus === null || projectId === null || projectId !== scope.projectId || buildertrendJobId === null || buildertrendJobId !== scope.buildertrendJobId || bidPackageId === null || bidPackageId !== scope.bidPackageId || sourceHref === null || !sourceHrefMatchesScope(sourceHref, scope, requestId) || typeof sourceBidAmount !== "number") {
    errors.push(`top_nested_identity_mismatch:${requestId ?? "unknown"}`)
    return { normalized: null, derivation: null }
  }
  const sourceRow = capture.sourceRow
  if (sourceRow !== undefined && (text(sourceRow.id) === null || sourceRow.organization_id !== scope.organizationId || sourceRow.source_key !== `job:${scope.buildertrendJobId}:rfq_response:${requestId}` || sourceRow.requested_project_id !== scope.projectId || sourceRow.project_id !== scope.projectId || sourceRow.source_scope !== "job" || sourceRow.source_record_type !== "rfq_response" || sourceRow.buildertrend_job_id !== scope.buildertrendJobId || sourceRow.buildertrend_record_id !== requestId || sourceRow.buildertrend_record_number !== requestId || typeof sourceRow.buildertrend_url !== "string" || !sourceHrefMatchesScope(sourceRow.buildertrend_url, scope, requestId) || sourceRow.raw_payload_json !== capture.payloadJson)) {
    errors.push(`source_row_identity_mismatch:${requestId}`)
  }
  if (submittedAt !== null && !validCalendarDate(submittedAt)) {
    errors.push(`submitted_date_not_calendar_only:${requestId}`)
  }
  const bidAmountCents = numberToCents(sourceBidAmount)
  const totalPlain = text(responseEvidence.total)
  const totalCents = decimalCents(totalPlain)
  if (bidAmountCents === null || totalPlain === null || totalCents === null || bidAmountCents !== totalCents) {
    errors.push(`response_total_mismatch:${requestId}`)
    return { normalized: null, derivation: null }
  }
  const lineResult = lineItems(payload, requestId, errors)
  const lineCents = lineResult.lineDecimals.map((value) => decimalCents(value) ?? 0)
  const lineSum = lineCents.reduce((sum, value) => sum + value, 0)
  if (lineResult.lineDecimals.length === 0 || lineSum !== totalCents) {
    errors.push(`response_line_sum_mismatch:${requestId}`)
  }
  const attachments = attachmentEvidence(payload, requestId, errors)
  const detailSourceHref = text(responseEvidence.detailSourceHref)
  if (detailSourceHref === null || !sourceHrefMatchesScope(detailSourceHref, scope, requestId)) {
    errors.push(`detail_source_href_identity_mismatch:${requestId}`)
  }
  const normalized: JsonRecord = {
    id: `bt-rfq-response-${requestId}`,
    sourceKey: `job:${scope.buildertrendJobId}:rfq_response:${requestId}`,
    project: { projectId: scope.projectId, buildertrendJobId: scope.buildertrendJobId, bidPackageId: scope.bidPackageId },
    source: { sourceBidRequestId: requestId, sourceHref },
    vendor: {
      displayName: vendor,
      legacyParticipantEvidence: {
        submittedBy: responseEvidence.submittedBy ?? null,
        primaryEmailDisplay: responseEvidence.primaryEmail ?? null,
        additionalEmailDisplay: responseEvidence.additionalEmails ?? [],
        phone: responseEvidence.phone ?? null,
        cell: responseEvidence.cell ?? null,
      },
    },
    status: {
      sourceStatus,
      submitted: sourceStatus === "Submitted",
      pricedSubmission: sourceStatus === "Submitted" && bidAmountCents > 0,
      releaseDateDisplay: null,
      submittedDisplay: submittedAt,
      timezone: null,
    },
    financial: {
      amountDisplay: moneyDisplay(bidAmountCents),
      totalDisplay: moneyDisplay(totalCents),
      lines: lineResult.lines,
      derivedMoney: true,
      sourceBidAmount,
      sourceTotalPlainDecimal: totalPlain,
    },
    attachments,
    legacyEvidence: {
      adapter: "o152-older-source-adapter-v1",
      sourcePayloadJson: capture.payloadJson,
      sourceProvenance: payload.provenance ?? null,
      sourceArtifact: payload.sourceArtifact ?? null,
      sourceHref,
      detailSourceHref,
      sourceDates: { submittedAtPlainDate: submittedAt, timezone: null },
      sourceMoney: {
        bidAmount: sourceBidAmount,
        total: totalPlain,
        lineItems: responseEvidence.lineItems ?? [],
      },
      sourceParticipants: {
        submittedBy: responseEvidence.submittedBy ?? null,
        primaryEmailDisplay: responseEvidence.primaryEmail ?? null,
        additionalEmailsDisplay: responseEvidence.additionalEmails ?? [],
      },
      sourceAttachmentEvidence: payload.attachmentEvidence ?? [],
      recipientAccessVerified: false,
      approvalObserved: false,
    },
  }
  return {
    normalized,
    derivation: {
      requestId,
      sourceBidAmount,
      sourceTotalPlainDecimal: totalPlain,
      sourceLineBuilderCostPlainDecimals: lineResult.lineDecimals,
      derivedAmountDisplay: moneyDisplay(bidAmountCents),
      derivedAmountCents: bidAmountCents,
    },
  }
}

function normalizedResult(
  result: RfqHistoricalResult,
  moneyDerivations: readonly O152MoneyDerivation[],
): O152AdapterResult {
  return result.success
    ? { success: true, requests: result.requests, moneyDerivations }
    : { success: false, errors: result.errors, moneyDerivations }
}

/**
 * Adapts the older O-152 payload to the current historical request shape.
 * The original payload JSON remains a string nested in legacyEvidence.
 */
export function adaptO152Capture(
  capture: O152Capture,
  scope: RfqHistoricalScope,
  proofs: readonly RfqFileProof[],
): O152AdapterResult {
  let payload: JsonRecord
  try {
    const parsed: unknown = JSON.parse(capture.payloadJson)
    if (!record(parsed)) return { success: false, errors: ["o152_payload_json_not_object"], moneyDerivations: [] }
    if (!sameJson(parsed, capture.payload)) return { success: false, errors: ["o152_payload_json_value_mismatch"], moneyDerivations: [] }
    payload = parsed
  } catch {
    return { success: false, errors: ["o152_payload_json_invalid"], moneyDerivations: [] }
  }
  const errors: string[] = []
  const built = makeNormalizedRequest(payload, capture, scope, errors)
  if (built.normalized === null || built.derivation === null || errors.length > 0) {
    return { success: false, errors, moneyDerivations: built.derivation === null ? [] : [built.derivation] }
  }
  const result = buildHistoricalRfqRequests([built.normalized], scope, proofs)
  return normalizedResult(result, [built.derivation])
}
