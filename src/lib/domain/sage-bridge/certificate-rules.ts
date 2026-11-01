/**
 * Pure rules for keeping Sage's vendor certificates (Vendors → Certificates)
 * in step with the trade docs on file in Compass. Compass is the source of
 * truth: every required document becomes one certificate row, and the
 * vendor's flag/hold choice sets that row's Warning and Stop Pay. No
 * database or network access here.
 */
import type { TradeDocLine, TradeDocSummary } from "@/lib/trade-docs/status"
import type { TradeDocBillMode } from "@/lib/trade-docs/settings"

/** Sage's certificate description is at most 50 characters. */
const SAGE_DESC_MAX = 50

export type SageYesNo = "Y" | "N"

/** One certificate row Compass wants on the vendor in Sage. */
export type SageCertificateLine = {
  readonly docTypeId: string
  readonly desc: string
  /** Descriptions (lowercased) that identify this row among the vendor's existing Sage certificates. */
  readonly matchNames: readonly string[]
  readonly receivedDate: string | null
  readonly expiryDate: string | null
  readonly warn: SageYesNo
  readonly stopPay: SageYesNo
  readonly memo: string
}

export type SageCertificatePlanInput = {
  readonly summary: TradeDocSummary
  /** The vendor's own choice, else the company default. */
  readonly billMode: TradeDocBillMode
  /** Rollout switch: warn on everything, never stop payment. */
  readonly warnOnly: boolean
  /** Sage's description for a document type, when it differs from the Compass label. */
  readonly sageNames: Readonly<Record<string, string>>
  /**
   * The expiry Sage gets for a document never received, so Sage treats it as
   * overdue (Sage only warns or stops payment on expired certificates).
   */
  readonly missingExpiresOn: string
}

function sageDesc(line: TradeDocLine, sageNames: Readonly<Record<string, string>>): string {
  const named = sageNames[line.type.id]?.trim()
  return (named && named.length > 0 ? named : line.type.label).slice(0, SAGE_DESC_MAX)
}

function receivedOn(line: TradeDocLine): string | null {
  const doc = line.doc
  if (!doc) return null
  return doc.effectiveOn ?? doc.createdAt.slice(0, 10)
}

/** Warning and Stop Pay for a document the vendor owes or may owe later. */
export function sageCertificateFlags(billMode: TradeDocBillMode, warnOnly: boolean): { readonly warn: SageYesNo; readonly stopPay: SageYesNo } {
  if (billMode === "off") return { warn: "N", stopPay: "N" }
  return { warn: "Y", stopPay: billMode === "hold" && !warnOnly ? "Y" : "N" }
}

function lineFor(line: TradeDocLine, input: SageCertificatePlanInput): SageCertificateLine {
  const desc = sageDesc(line, input.sageNames)
  const matchNames = [...new Set([desc, line.type.label.slice(0, SAGE_DESC_MAX)].map((name) => name.trim().toLowerCase()))]
  const base = { docTypeId: line.type.id, desc, matchNames }
  if (line.state === "waived") {
    return {
      ...base,
      receivedDate: receivedOn(line),
      expiryDate: null,
      warn: "N",
      stopPay: "N",
      memo: `Alternative accepted in Compass${line.type.waiverLabel ? `: ${line.type.waiverLabel}` : ""}.`,
    }
  }
  const flags = sageCertificateFlags(input.billMode, input.warnOnly)
  if (line.state === "missing") {
    return { ...base, receivedDate: null, expiryDate: input.missingExpiresOn, ...flags, memo: "Not received. Kept by Compass." }
  }
  const doc = line.doc
  return {
    ...base,
    receivedDate: receivedOn(line),
    expiryDate: line.type.expires ? doc?.expiresOn ?? null : null,
    ...flags,
    memo: `On file in Compass${doc?.fileName ? ` (${doc.fileName})` : ""}. Kept by Compass.`.slice(0, 500),
  }
}

/** The certificate rows Sage should have for one vendor: one per required document. */
export function planSageCertificates(input: SageCertificatePlanInput): readonly SageCertificateLine[] {
  return input.summary.lines.filter((line) => line.required).map((line) => lineFor(line, input))
}

/** The day before `today` ("YYYY-MM-DD"), in UTC calendar days. */
export function dayBefore(today: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today)
  if (!match) throw new Error(`Not a date: ${today}`)
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - 86_400_000)
  return day.toISOString().slice(0, 10)
}
