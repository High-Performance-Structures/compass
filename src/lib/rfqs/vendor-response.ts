import type { PortalRfqPayload, PortalRfqVendorResponse } from "@/lib/rfqs/portal-response"

/**
 * A vendor's answer to an RFQ, from the vendor portal or a no-login price
 * link. Both go through here so prices are checked the same way.
 */
export type RfqVendorAnswerInput = {
  readonly decision: "quote" | "decline"
  readonly amount: number | null
  readonly lines: readonly { readonly lineNumber: number; readonly amount: number | null; readonly notes: string | null }[]
  readonly leadTime: string | null
  readonly validUntil: string | null
  readonly notes: string | null
}

export type RfqVendorAnswer =
  | { readonly ok: true; readonly response: Omit<PortalRfqVendorResponse, "responderUserId" | "responderName" | "responderCompany" | "submittedAt">; readonly amount: number | null }
  | { readonly ok: false; readonly error: string }

class AnswerError extends Error {}

/** Trimmed text, null when blank; longer than `max` is an answer error. */
function boundedText(value: string | null, max: number): string | null {
  const text = value?.trim() ?? ""
  if (!text) return null
  if (text.length > max) throw new AnswerError(`Text must be ${max.toLocaleString()} characters or fewer.`)
  return text
}

function roundedToCents(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100
}

function validDate(value: string | null): string | null {
  const text = value?.trim() ?? ""
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new AnswerError("Valid until must be a valid date.")
  return text
}

export function checkRfqVendorAnswer(payload: Pick<PortalRfqPayload, "scopeItems">, input: RfqVendorAnswerInput): RfqVendorAnswer {
  try {
    return checkAnswer(payload, input)
  } catch (error) {
    if (error instanceof AnswerError) return { ok: false, error: error.message }
    throw error
  }
}

function checkAnswer(payload: Pick<PortalRfqPayload, "scopeItems">, input: RfqVendorAnswerInput): RfqVendorAnswer {
  if (input.decision !== "quote" && input.decision !== "decline") return { ok: false, error: "Choose quote or decline." }
  let amount = roundedToCents(input.amount)
  const lines =
    input.decision === "quote"
      ? input.lines.map((line) => ({ lineNumber: line.lineNumber, amount: roundedToCents(line.amount), notes: boundedText(line.notes, 2_000) }))
      : []
  if (input.decision === "quote" && payload.scopeItems.length > 0) {
    // A quote prices every scope line; the total is their sum.
    const expected = new Set(payload.scopeItems.map((line) => line.lineNumber))
    const submitted = new Set(lines.map((line) => line.lineNumber))
    const complete = expected.size === lines.length && expected.size === submitted.size && [...expected].every((lineNumber) => submitted.has(lineNumber))
    if (!complete || lines.some((line) => line.amount === null || line.amount < 0)) {
      return { ok: false, error: "Enter a valid price for every RFQ scope line." }
    }
    amount = lines.reduce((total, line) => total + (line.amount ?? 0), 0)
  }
  if (input.decision === "quote" && (amount === null || amount < 0)) return { ok: false, error: "Enter a valid quote amount." }
  return {
    ok: true,
    amount: input.decision === "quote" ? amount : null,
    response: {
      decision: input.decision,
      amount: input.decision === "quote" ? amount : null,
      lines: lines.flatMap((line) => (line.amount === null ? [] : [{ lineNumber: line.lineNumber, amount: line.amount, notes: line.notes }])),
      leadTime: boundedText(input.leadTime, 240),
      validUntil: validDate(input.validUntil),
      notes: boundedText(input.notes, 10_000),
    },
  }
}
