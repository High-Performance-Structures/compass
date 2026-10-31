import { findPricingSource, type PricingSource } from "@/lib/estimates/pricing-sources"
import { parsePortalRfqPayload } from "@/lib/rfqs/portal-response"

/**
 * Pricing board: every estimate line that needs a number from someone, and
 * the RFQs on this job that ask for it. RFQs match lines by cost code, so a
 * new estimate version (or an RFQ made on the RFQs page) still lines up.
 */

export type PricingBoardLineInput = {
  readonly id: string
  readonly costCode: string
  readonly costCodeName: string
  readonly description: string
  readonly divisionCode: string
  readonly lineTotalCents: number
  readonly pricingSource: string | null
  readonly todo: { readonly status: string; readonly assigneeName: string | null } | null
}

export type PricingBoardRfqInput = {
  readonly id: string
  readonly number: string | null
  readonly title: string
  readonly status: string
  readonly companyName: string | null
  readonly payloadJson: string | null
  readonly hasManualResponse: boolean
}

export type PricingBoardRfq = {
  readonly id: string
  readonly number: string | null
  readonly vendor: string
  readonly recipientEmail: string | null
  readonly status: PricingBoardRfqStatus
  readonly costCodes: readonly string[]
}

export type PricingBoardRfqStatus = "draft" | "sent" | "quoted" | "declined" | "closed"

type PricingBoardPackage = {
  readonly id: string
  readonly title: string
  readonly costCodes: readonly string[]
  readonly rfqs: readonly PricingBoardRfq[]
}

export type PricingBoardLine = {
  readonly id: string
  readonly costCode: string
  readonly costCodeName: string
  readonly description: string
  readonly lineTotalCents: number
  readonly source: PricingSource
  readonly rfqCount: number
  readonly quoteCount: number
  readonly todo: PricingBoardLineInput["todo"]
}

export type PricingBoard = {
  readonly lines: readonly PricingBoardLine[]
  readonly packages: readonly PricingBoardPackage[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * The bid package an RFQ belongs to: RFQs made together on the pricing board,
 * or duplicated for another vendor, share one. Title only for board packages.
 */
function rfqBidPackageOf(payloadJson: string | null): { readonly id: string | null; readonly title: string | null } {
  if (!payloadJson) return { id: null, title: null }
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    if (!isRecord(parsed)) return { id: null, title: null }
    const id = typeof parsed.bidPackageId === "string" ? parsed.bidPackageId : null
    const title = isRecord(parsed.estimatePackage) && typeof parsed.estimatePackage.title === "string" ? parsed.estimatePackage.title : null
    return { id, title }
  } catch {
    return { id: null, title: null }
  }
}

export function pricingBoardRfqStatus(rfq: Pick<PricingBoardRfqInput, "status" | "payloadJson" | "hasManualResponse">): PricingBoardRfqStatus {
  const status = rfq.status.trim().toLowerCase()
  if (["void", "cancelled", "canceled", "closed"].includes(status)) return "closed"
  const response = parsePortalRfqPayload(rfq.payloadJson).vendorResponse
  if (response?.decision === "decline") return "declined"
  if (response?.decision === "quote" || rfq.hasManualResponse || status === "response_received" || status === "awarded") return "quoted"
  return status === "draft" ? "draft" : "sent"
}

function rfqCostCodes(payloadJson: string | null): readonly string[] {
  const codes = parsePortalRfqPayload(payloadJson)
    .scopeItems.map((item) => item.costCode)
    .filter((code): code is string => code !== null)
  return [...new Set(codes)]
}

export function buildPricingBoard(input: {
  readonly sources: readonly PricingSource[]
  readonly lines: readonly PricingBoardLineInput[]
  readonly rfqs: readonly PricingBoardRfqInput[]
}): PricingBoard {
  const rfqs = input.rfqs.map((rfq) => ({
    rfq: {
      id: rfq.id,
      number: rfq.number,
      vendor: rfq.companyName?.trim() || "Vendor not chosen",
      recipientEmail: parsePortalRfqPayload(rfq.payloadJson).recipientEmail,
      status: pricingBoardRfqStatus(rfq),
      costCodes: rfqCostCodes(rfq.payloadJson),
    },
    bidPackage: rfqBidPackageOf(rfq.payloadJson),
    title: rfq.title,
  }))
  const lineCodes = new Set(input.lines.map((line) => line.costCode))
  const relevant = rfqs.filter(({ rfq }) => rfq.costCodes.some((code) => lineCodes.has(code)))

  const lines = input.lines.flatMap((line) => {
    const source = findPricingSource(input.sources, line.pricingSource)
    if (!source) return []
    const forLine = relevant.filter(({ rfq }) => rfq.status !== "closed" && rfq.costCodes.includes(line.costCode))
    return [
      {
        id: line.id,
        costCode: line.costCode,
        costCodeName: line.costCodeName,
        description: line.description,
        lineTotalCents: line.lineTotalCents,
        source,
        rfqCount: forLine.length,
        quoteCount: forLine.filter(({ rfq }) => rfq.status === "quoted").length,
        todo: line.todo,
      },
    ]
  })

  // RFQs from the board group by package; any other RFQ is its own package.
  const packages = new Map<string, { id: string; title: string; rfqs: PricingBoardRfq[] }>()
  for (const { rfq, bidPackage, title } of relevant) {
    // Duplicates of an RFQ with no package carry that RFQ's id, so they group with it.
    const key = bidPackage.id ?? rfq.id
    const current = packages.get(key) ?? { id: key, title: bidPackage.title ?? title, rfqs: [] }
    if (bidPackage.title) current.title = bidPackage.title
    current.rfqs.push(rfq)
    packages.set(key, current)
  }
  return {
    lines,
    packages: [...packages.values()].map((pkg) => ({
      ...pkg,
      costCodes: [...new Set(pkg.rfqs.flatMap((rfq) => rfq.costCodes))].sort(),
    })),
  }
}

/** A default package title from its cost codes, e.g. "16.100 Electrical + 16.400 Low voltage". */
export function defaultPackageTitle(lines: readonly { readonly costCode: string; readonly costCodeName: string }[]): string {
  const title = lines.map((line) => `${line.costCode} ${line.costCodeName}`).join(" + ")
  return title.length > 120 ? `${title.slice(0, 117)}...` : title
}

/** Why these lines can't go out together as one RFQ package, or null when they can. */
export function packageSelectionProblem(lines: readonly PricingBoardLine[]): string | null {
  if (lines.length === 0) return "Choose at least one cost code."
  if (lines.some((line) => line.source.action === "takeoff")) return "Lines our own staff price get a takeoff to-do, not a quote request."
  if (new Set(lines.map((line) => line.source.id)).size > 1) return "Combine lines with the same \"Priced by\" choice."
  return null
}
