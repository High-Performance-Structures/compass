import type { PortalRfqVendorResponse } from "@/lib/rfqs/portal-response"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function currencyAmountToCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 100)
}

export function rfqResponseCoversScope(
  scopeLineNumbers: readonly number[],
  responseLines: readonly { readonly lineNumber: number }[]
): boolean {
  if (scopeLineNumbers.length === 0) return true
  const expected = new Set(scopeLineNumbers)
  const submitted = new Set(responseLines.map((line) => line.lineNumber))
  return (
    expected.size === scopeLineNumbers.length &&
    expected.size === responseLines.length &&
    expected.size === submitted.size &&
    [...expected].every((lineNumber) => submitted.has(lineNumber))
  )
}

export type ApprovedRfqBidSnapshot = {
  readonly version: 1
  readonly totalCents: number
  readonly lines: readonly {
    readonly lineNumber: number
    readonly amountCents: number
    readonly notes: string | null
  }[]
  readonly leadTime: string | null
  readonly validUntil: string | null
  readonly notes: string | null
  readonly responderUserId: string
  readonly responderName: string
  readonly responderCompany: string | null
  readonly submittedAt: string
}

export function approvedRfqResponseSnapshot(
  response: PortalRfqVendorResponse
): string {
  return JSON.stringify({
    version: 1,
    totalCents: currencyAmountToCents(response.amount ?? 0),
    lines: response.lines.map((line) => ({
      lineNumber: line.lineNumber,
      amountCents: currencyAmountToCents(line.amount),
      notes: line.notes,
    })),
    leadTime: response.leadTime,
    validUntil: response.validUntil,
    notes: response.notes,
    responderUserId: response.responderUserId,
    responderName: response.responderName,
    responderCompany: response.responderCompany,
    submittedAt: response.submittedAt,
  })
}

function text(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key]
  return typeof candidate === "string" && candidate.trim()
    ? candidate
    : null
}

function integer(value: Record<string, unknown>, key: string): number | null {
  const candidate = value[key]
  return typeof candidate === "number" &&
    Number.isSafeInteger(candidate) &&
    candidate >= 0
    ? candidate
    : null
}

export function parseApprovedRfqResponseSnapshot(
  value: string
): ApprovedRfqBidSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return null
    if (integer(parsed, "version") !== 1) return null
    const totalCents = integer(parsed, "totalCents")
    const responderUserId = text(parsed, "responderUserId")
    const responderName = text(parsed, "responderName")
    const submittedAt = text(parsed, "submittedAt")
    if (
      totalCents === null ||
      !responderUserId ||
      !responderName ||
      !submittedAt
    ) {
      return null
    }
    const rawLines = parsed.lines
    const lines = Array.isArray(rawLines)
      ? rawLines.flatMap((line) => {
          if (!isRecord(line)) return []
          const lineNumber = integer(line, "lineNumber")
          const amountCents = integer(line, "amountCents")
          if (lineNumber === null || lineNumber < 1 || amountCents === null) {
            return []
          }
          return [{ lineNumber, amountCents, notes: text(line, "notes") }]
        })
      : []
    return {
      version: 1,
      totalCents,
      lines,
      leadTime: text(parsed, "leadTime"),
      validUntil: text(parsed, "validUntil"),
      notes: text(parsed, "notes"),
      responderUserId,
      responderName,
      responderCompany: text(parsed, "responderCompany"),
      submittedAt,
    }
  } catch {
    return null
  }
}
