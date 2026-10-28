import { parsePortalRfqPayload } from "@/lib/rfqs/portal-response"

/**
 * The Bids window: every answer on this job's RFQs that covers one cost
 * code, with that code's price and the rest of what the vendor priced in the
 * same request, so accepting one can fill all of them.
 */

export type LineBidRfqInput = {
  readonly id: string
  readonly number: string | null
  readonly title: string
  readonly status: string
  readonly companyName: string | null
  readonly payloadJson: string | null
  readonly approvalId: string | null
  /** Scope lines already imported into this estimate from this bid. */
  readonly importedLineNumbers: readonly number[]
}

export type LineBidScopeLine = {
  readonly lineNumber: number
  readonly costCode: string | null
  readonly description: string
  readonly amountCents: number | null
  readonly imported: boolean
}

export type LineBid = {
  readonly rfqId: string
  readonly rfqNumber: string | null
  readonly vendor: string
  readonly decision: "quote" | "decline"
  readonly state: "quoted" | "declined" | "approved" | "accepted"
  /** This cost code's price; null when the vendor gave one total for several lines. */
  readonly priceCents: number | null
  readonly totalCents: number | null
  readonly lines: readonly LineBidScopeLine[]
  readonly leadTime: string | null
  readonly validUntil: string | null
  readonly notes: string | null
  readonly submittedAt: string
  readonly approvalId: string | null
}

function cents(amount: number): number {
  return Math.round(amount * 100)
}

export function bidsForCostCode(costCode: string, rfqs: readonly LineBidRfqInput[]): readonly LineBid[] {
  const bids = rfqs.flatMap((rfq): LineBid[] => {
    const payload = parsePortalRfqPayload(rfq.payloadJson)
    const response = payload.vendorResponse
    if (!response) return []
    if (!payload.scopeItems.some((item) => item.costCode === costCode)) return []
    const priced = new Map(response.lines.map((line) => [line.lineNumber, line.amount]))
    // A single-line request answered with only a total prices that line.
    const onlyLine = payload.scopeItems.length === 1 ? payload.scopeItems[0] : undefined
    const lines = payload.scopeItems.map((item) => {
      const amount = priced.get(item.lineNumber) ?? (onlyLine && response.amount !== null ? response.amount : undefined)
      return {
        lineNumber: item.lineNumber,
        costCode: item.costCode,
        description: item.description,
        amountCents: response.decision === "quote" && amount !== undefined ? cents(amount) : null,
        imported: rfq.importedLineNumbers.includes(item.lineNumber),
      }
    })
    const forCode = lines.filter((line) => line.costCode === costCode)
    const priceCents = forCode.every((line) => line.amountCents !== null)
      ? forCode.reduce((total, line) => total + (line.amountCents ?? 0), 0)
      : null
    const state: LineBid["state"] =
      response.decision === "decline"
        ? "declined"
        : forCode.some((line) => line.imported)
          ? "accepted"
          : rfq.approvalId
            ? "approved"
            : "quoted"
    return [
      {
        rfqId: rfq.id,
        rfqNumber: rfq.number,
        vendor: response.responderCompany?.trim() || rfq.companyName?.trim() || response.responderName,
        decision: response.decision,
        state,
        priceCents: response.decision === "quote" ? priceCents : null,
        totalCents: response.amount === null ? null : cents(response.amount),
        lines,
        leadTime: response.leadTime,
        validUntil: response.validUntil,
        notes: response.notes,
        submittedAt: response.submittedAt,
        approvalId: rfq.approvalId,
      },
    ]
  })
  // Quotes first, cheapest first; declines last.
  return [...bids].sort((a, b) => {
    if (a.decision !== b.decision) return a.decision === "quote" ? -1 : 1
    return (a.priceCents ?? Number.MAX_SAFE_INTEGER) - (b.priceCents ?? Number.MAX_SAFE_INTEGER)
  })
}

/** Scope lines accepting this bid would fill: every priced line not imported yet. */
export function acceptableLines(bid: LineBid): readonly LineBidScopeLine[] {
  return bid.lines.filter((line) => line.amountCents !== null && !line.imported)
}
