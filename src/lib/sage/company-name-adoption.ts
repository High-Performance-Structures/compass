import { sameSageRecordId } from "@/lib/sage/record-id"

/**
 * "Use Sage name": a Sage-linked client or vendor company takes the exact
 * company name Sage holds. Nothing is written to Sage; Compass copies Sage's
 * value, which is what the Sage identity gate protects.
 *
 * The contact read-back snapshot carries only the editable contact fields, so
 * the company name comes from the copy of Sage's client or vendor list the
 * signed Sage writer sends (sage_client_directory_entries and
 * sage_vendor_directory_entries), matched on the linked Sage record id.
 */

export type SageCompanyKind = "client_company" | "vendor_company"

/**
 * Sage's vendor list is re-sent once a day; a day and a half allows one late
 * writer poll. Older copies must be refreshed before Compass trusts them.
 */
export const SAGE_COMPANY_NAME_MAX_AGE_MS = 36 * 60 * 60 * 1000

export type SageCompanyNameStatus =
  /** The company has no verified Sage record id yet. */
  | "unlinked"
  /** Sage's list has no entry for the linked record, or it disagrees on number. */
  | "missing"
  /** Sage's list is older than SAGE_COMPANY_NAME_MAX_AGE_MS. */
  | "stale"
  | "same"
  | "differs"
  /**
   * Compass shows a new name that a Sage change request is still sending to
   * Sage: the difference is expected, not drift.
   */
  | "pending"

export type SageCompanyNameEntry = {
  readonly sageRecordId: string
  readonly sageNumber: string
  readonly name: string
  readonly capturedAt: string
}

export function sageCompanyNameStatus(input: {
  readonly compassName: string
  readonly sageRecordId: string | null
  readonly sageNumber: string | null
  readonly entry: SageCompanyNameEntry | null
  /** The name has an unfinished Sage change (see sage-held-fields.ts). */
  readonly namePending?: boolean
}, now = Date.now()): SageCompanyNameStatus {
  if (!input.sageRecordId) return "unlinked"
  if (input.namePending) return "pending"
  const entry = input.entry
  if (!entry || !entry.name.trim() ||
    !sameSageRecordId(entry.sageRecordId, input.sageRecordId) ||
    (input.sageNumber !== null && entry.sageNumber !== input.sageNumber)) return "missing"
  const captured = Date.parse(entry.capturedAt)
  if (!Number.isFinite(captured) || captured > now || now - captured > SAGE_COMPANY_NAME_MAX_AGE_MS) return "stale"
  return input.compassName === entry.name.trim() ? "same" : "differs"
}

export function sageCompanyNameError(kind: SageCompanyKind, status: SageCompanyNameStatus): string | null {
  const list = kind === "client_company" ? "client" : "vendor"
  if (status === "pending") return "A Sage name change is waiting. Reject it to keep the name Sage has."
  if (status === "unlinked") return "Review and link the stable Sage record ID before using the Sage name."
  if (status === "missing") return `This company was not found in Sage's ${list} list. Refresh this contact from Sage, then try again.`
  if (status === "stale") {
    return kind === "client_company"
      ? "Refresh this contact from Sage first: refresh the Sage client list, then try again."
      : "Refresh this contact from Sage first: Sage's vendor list is more than a day old. The Sage writer re-sends it daily."
  }
  return null
}
