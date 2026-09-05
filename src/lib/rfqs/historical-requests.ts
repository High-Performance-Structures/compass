/** Internal historical read model, not a native vendor submission or an access grant. */
export type RfqHistoricalScope = {
  readonly organizationId: string
  readonly projectId: string
  readonly buildertrendJobId: string
  readonly bidPackageId: string
  readonly canonicalDriveRootId: string
}

export type RfqFileProof = RfqHistoricalScope & {
  readonly requestId: string
  readonly documentInstanceId: string
  readonly driveFileId: string
  readonly sourceSha256: string
  readonly destinationSha256: string
  readonly sourceBytes: number
  readonly destinationBytes: number
  readonly verificationReceiptSha256: string
}

export type RfqHistoricalAttachment = {
  readonly documentInstanceId: string
  readonly label: string
} & (
  | { readonly status: "held"; readonly reason: "original_not_verified" }
  | {
      readonly status: "verified"
      readonly driveFileId: string
      readonly url: string
      readonly sha256: string
      readonly bytes: number
      readonly verificationReceiptSha256: string
    }
)

export type RfqHistoricalRequest = {
  readonly historicalKey: string
  readonly requestId: string
  readonly sourceRecordId: string
  readonly scope: RfqHistoricalScope
  readonly vendorDisplay: string
  readonly sourceStatus: string
  readonly releasedDisplay: string | null
  readonly submittedDisplay: string | null
  readonly sourceAmountDisplay: string | null
  readonly amountDisplayProvenance: "captured" | "derived"
  readonly submittedAmountCents: number | null
  readonly lines: readonly RfqHistoricalLine[]
  readonly pricingReconciliation: "unpriced" | "exact" | "incomplete"
  readonly submission: "draft" | "submitted" | "other"
  readonly attachments: readonly RfqHistoricalAttachment[]
  /** Exact supplied capture serialized, including unknown fields and original provenance. */
  readonly capturedRequestJson: string
}

export type RfqHistoricalLine = {
  readonly lineNumber: number
  readonly title: string | null
  readonly description: string | null
  readonly expandedDescription: string | null
  readonly costCodeDisplay: string | null
  readonly costTypeDisplay: string | null
  readonly unitCostDisplay: string | null
  readonly quantityDisplay: string | null
  readonly unitDisplay: string | null
  readonly builderCostDisplay: string | null
  readonly submittedLineAmountCents: number | null
}

export type RfqHistoricalResult =
  | { readonly success: true; readonly requests: readonly RfqHistoricalRequest[] }
  | { readonly success: false; readonly errors: readonly string[] }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function decimalId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value)
}

function token(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value)
}

function sourceHrefMatchesScope(value: unknown, scope: RfqHistoricalScope, requestId: string): boolean {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.host === "buildertrend.net" &&
      url.username === "" && url.password === "" && url.hash === "" &&
      url.pathname === `/app/BidPackages/BidPackage/${scope.bidPackageId}/${scope.buildertrendJobId}/Bid/${requestId}/${scope.buildertrendJobId}/0/0`
  } catch { return false }
}

function cents(value: string | null): number | null {
  if (value === null || !/^\$(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+)\.[0-9]{2}$/.test(value)) return null
  const result = Number(value.replace(/[$,.]/g, ""))
  return Number.isSafeInteger(result) ? result : null
}

function sameScope(left: RfqHistoricalScope, right: RfqHistoricalScope): boolean {
  return left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.buildertrendJobId === right.buildertrendJobId &&
    left.bidPackageId === right.bidPackageId &&
    left.canonicalDriveRootId === right.canonicalDriveRootId
}

/**
 * Call only after project/feature/internal-audience authorization and an org-scoped read.
 * Proofs must come from reviewed source/destination byte receipts, never title matching.
 * Rejects the entire batch on identity/evidence conflicts. Missing originals remain visible
 * as held labels; Buildertrend provenance URLs are never used as attachment fallbacks.
 */
export function buildHistoricalRfqRequests(
  input: unknown,
  scope: RfqHistoricalScope,
  proofs: readonly RfqFileProof[]
): RfqHistoricalResult {
  const errors: string[] = []
  if (!scope.organizationId || !scope.projectId || !decimalId(scope.buildertrendJobId) ||
      !decimalId(scope.bidPackageId) || !token(scope.canonicalDriveRootId)) {
    return { success: false, errors: ["invalid_scope"] }
  }
  if (!Array.isArray(input)) return { success: false, errors: ["requests_not_array"] }
  const proofMap = new Map<string, RfqFileProof>()
  for (const proof of proofs) {
    const key = `${proof.requestId}:${proof.documentInstanceId}`
    if (!sameScope(proof, scope) || !decimalId(proof.requestId) ||
        !decimalId(proof.documentInstanceId) || !token(proof.driveFileId) ||
        !/^[a-f0-9]{64}$/.test(proof.sourceSha256) ||
        proof.sourceSha256 !== proof.destinationSha256 ||
        !/^[a-f0-9]{64}$/.test(proof.verificationReceiptSha256) ||
        !Number.isSafeInteger(proof.sourceBytes) || proof.sourceBytes <= 0 ||
        proof.sourceBytes !== proof.destinationBytes || proofMap.has(key)) {
      errors.push(`invalid_or_duplicate_file_proof:${key}`)
    }
    proofMap.set(key, proof)
  }
  const usedProofs = new Set<string>()
  const requestIds = new Set<string>()
  const requests: RfqHistoricalRequest[] = []
  for (const [index, value] of input.entries()) {
    if (!record(value) || !record(value.project) || !record(value.source) ||
        !record(value.vendor) || !record(value.status) || !record(value.financial) ||
        !Array.isArray(value.attachments)) {
      errors.push(`invalid_request_shape:${index}`)
      continue
    }
    const requestId = value.source.sourceBidRequestId
    if (!decimalId(requestId) || !sourceHrefMatchesScope(value.source.sourceHref, scope, requestId) ||
        value.id !== `bt-rfq-response-${requestId}` ||
        value.sourceKey !== `job:${scope.buildertrendJobId}:rfq_response:${requestId}` ||
        value.project.projectId !== scope.projectId ||
        value.project.buildertrendJobId !== scope.buildertrendJobId ||
        value.project.bidPackageId !== scope.bidPackageId || requestIds.has(requestId)) {
      errors.push(`identity_or_duplicate_request:${index}`)
      continue
    }
    requestIds.add(requestId)
    const vendorDisplay = text(value.vendor.displayName)
    const sourceStatus = text(value.status.sourceStatus)
    if (vendorDisplay === null || sourceStatus === null) {
      errors.push(`missing_vendor_or_status:${requestId}`)
      continue
    }
    const submission = sourceStatus === "Draft" ? "draft" : sourceStatus === "Submitted" ? "submitted" : "other"
    if ((submission === "draft" && (value.status.submitted !== false || value.status.pricedSubmission !== false)) ||
        (submission === "submitted" && value.status.submitted !== true)) {
      errors.push(`submission_state_conflict:${requestId}`)
    }
    const amountDisplay = text(value.financial.amountDisplay)
    const submittedAmount = submission === "submitted" && value.status.pricedSubmission === true ? cents(amountDisplay) : null
    if (submission === "submitted" && value.status.pricedSubmission === true && submittedAmount === null) {
      errors.push(`invalid_priced_amount:${requestId}`)
    }
    const lines: RfqHistoricalLine[] = []
    if (Array.isArray(value.financial.lines)) {
      for (const [lineIndex, sourceLine] of value.financial.lines.entries()) {
        if (!record(sourceLine)) {
          errors.push(`invalid_source_line:${requestId}:${lineIndex}`)
          continue
        }
        const builderCostDisplay = text(sourceLine.builderCostDisplay)
        lines.push({ lineNumber: lineIndex + 1, title: text(sourceLine.title), description: text(sourceLine.description),
          expandedDescription: text(sourceLine.expandedDescription), costCodeDisplay: text(sourceLine.costCode),
          costTypeDisplay: text(sourceLine.costType), unitCostDisplay: text(sourceLine.unitCostDisplay),
          quantityDisplay: text(sourceLine.quantityDisplay), unitDisplay: text(sourceLine.unitDisplay), builderCostDisplay,
          submittedLineAmountCents: submittedAmount !== null ? cents(builderCostDisplay) : null })
      }
    }
    const totalDisplay = text(value.financial.totalDisplay)
    const totalCents = cents(totalDisplay)
    if (submittedAmount !== null && totalDisplay !== null && totalCents !== submittedAmount) {
      errors.push(`submitted_total_conflict:${requestId}`)
    }
    const completeLines = lines.length > 0 && lines.every(line => line.submittedLineAmountCents !== null)
    const lineSum = lines.reduce((sum, line) => sum + (line.submittedLineAmountCents ?? 0), 0)
    if (submittedAmount !== null && completeLines && (!Number.isSafeInteger(lineSum) || lineSum !== submittedAmount)) {
      errors.push(`submitted_line_sum_conflict:${requestId}`)
    }
    const pricingReconciliation = submittedAmount === null ? "unpriced" : completeLines && totalCents === submittedAmount ? "exact" : "incomplete"
    const attachmentIds = new Set<string>()
    const attachments: RfqHistoricalAttachment[] = []
    for (const attachment of value.attachments) {
      if (!record(attachment) || !decimalId(attachment.sourceDocumentInstanceId) ||
          attachment.sourceFileId !== attachment.sourceDocumentInstanceId || text(attachment.fileName) === null ||
          attachmentIds.has(attachment.sourceDocumentInstanceId)) {
        errors.push(`invalid_or_duplicate_attachment:${requestId}`)
        continue
      }
      const documentInstanceId = attachment.sourceDocumentInstanceId
      const label = text(attachment.fileName)
      if (label === null) continue
      attachmentIds.add(documentInstanceId)
      const key = `${requestId}:${documentInstanceId}`
      const proof = proofMap.get(key)
      if (proof === undefined) {
        attachments.push({ documentInstanceId, label, status: "held", reason: "original_not_verified" })
      } else {
        usedProofs.add(key)
        attachments.push({ documentInstanceId, label, status: "verified", driveFileId: proof.driveFileId,
          url: `https://drive.google.com/file/d/${proof.driveFileId}/view`, sha256: proof.sourceSha256,
          bytes: proof.sourceBytes, verificationReceiptSha256: proof.verificationReceiptSha256 })
      }
    }
    requests.push({ historicalKey: JSON.stringify([scope.organizationId, scope.projectId, scope.buildertrendJobId, scope.bidPackageId, requestId]),
      requestId, sourceRecordId: value.id, scope: { ...scope }, vendorDisplay, sourceStatus, submission,
      releasedDisplay: text(value.status.releaseDateDisplay), submittedDisplay: text(value.status.submittedDisplay),
      sourceAmountDisplay: amountDisplay, submittedAmountCents: submittedAmount,
      amountDisplayProvenance: value.financial.derivedMoney === true ? "derived" : "captured",
      lines, pricingReconciliation,
      attachments, capturedRequestJson: JSON.stringify(value) })
  }
  for (const key of proofMap.keys()) {
    if (!usedProofs.has(key)) errors.push(`unassociated_file_proof:${key}`)
  }
  return errors.length > 0 ? { success: false, errors } : { success: true, requests }
}
