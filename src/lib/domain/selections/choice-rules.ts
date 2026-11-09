/**
 * Pure rules for selection choices, supplier links and comments: input
 * validation and what each audience may see. No database or network access.
 */
import { toCents } from "@/lib/format"

import {
  SELECTION_CHOICE_STATUSES,
  SELECTION_COMMENT_VISIBILITIES,
  type SelectionChoiceStatus,
  type SelectionCommentVisibility,
} from "./statuses"

const CHOICE_TITLE_MAX = 200
const CHOICE_TEXT_MAX = 4000
const COMMENT_MAX = 4000
const LEAD_TIME_MAX_DAYS = 730

export type SelectionChoiceInput = {
  readonly title: string
  readonly description?: string | null
  /** Dollars as typed ("1,250.00"); blank for no price. */
  readonly price?: string | null
  /** What the owner sees (supplier price plus builder fee), as typed; blank for not yet. */
  readonly ownerPrice?: string | null
  /** Whole days as typed; blank for unknown. */
  readonly leadTimeDays?: string | null
  readonly vendorId?: string | null
  readonly supplierName?: string | null
  readonly status?: string | null
}

export type ParsedSelectionChoice = {
  readonly title: string
  readonly description: string | null
  readonly priceCents: number | null
  readonly ownerPriceCents: number | null
  readonly leadTimeDays: number | null
  readonly vendorId: string | null
  readonly supplierName: string | null
  readonly status: SelectionChoiceStatus
}

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

function optionalText(value: string | null | undefined, max: number): string | null {
  const text = value?.trim() ?? ""
  return text ? text.slice(0, max) : null
}

function isChoiceStatus(value: string): value is SelectionChoiceStatus {
  return SELECTION_CHOICE_STATUSES.some((status) => status === value)
}

function isCommentVisibility(value: string): value is SelectionCommentVisibility {
  return SELECTION_COMMENT_VISIBILITIES.some((visibility) => visibility === value)
}

/** Typed dollars as cents; null when blank. */
function moneyInput(value: string | null | undefined): number | null | "invalid" {
  const text = value?.trim() ?? ""
  if (!text) return null
  const cents = toCents(text)
  return cents === null || cents < 0 ? "invalid" : cents
}

/**
 * Over (+) or under (-) the allowance, in cents; null when either is
 * missing. Both sides are what the owner sees.
 */
export function allowanceDeltaCents(priceCents: number | null, allowanceCents: number | null): number | null {
  return priceCents === null || allowanceCents === null ? null : priceCents - allowanceCents
}

export function parseSelectionChoiceInput(input: SelectionChoiceInput): Parsed<ParsedSelectionChoice> {
  const title = input.title.trim()
  if (!title) return { ok: false, error: "Choice title is required." }
  if (title.length > CHOICE_TITLE_MAX) return { ok: false, error: `Choice title must be ${CHOICE_TITLE_MAX} characters or fewer.` }

  const priceCents = moneyInput(input.price)
  if (priceCents === "invalid") return { ok: false, error: "Supplier price must be a dollar amount of zero or more." }
  const ownerPriceCents = moneyInput(input.ownerPrice)
  if (ownerPriceCents === "invalid") return { ok: false, error: "Owner price must be a dollar amount of zero or more." }

  const leadText = input.leadTimeDays?.trim() ?? ""
  const leadTimeDays = leadText ? Number(leadText) : null
  if (leadTimeDays !== null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > LEAD_TIME_MAX_DAYS)) {
    return { ok: false, error: `Lead time must be whole days from 0 to ${LEAD_TIME_MAX_DAYS}.` }
  }

  const statusText = input.status?.trim() || "proposed"
  if (!isChoiceStatus(statusText)) return { ok: false, error: "Unknown choice status." }

  const vendorId = optionalText(input.vendorId, 200)
  return {
    ok: true,
    value: {
      title,
      description: optionalText(input.description, CHOICE_TEXT_MAX),
      priceCents,
      ownerPriceCents,
      leadTimeDays,
      vendorId,
      // A vendor record wins; the free-text supplier is the fallback.
      supplierName: vendorId ? null : optionalText(input.supplierName, CHOICE_TITLE_MAX),
      status: statusText,
    },
  }
}

export function parseCommentBody(body: string): Parsed<string> {
  const text = body.trim()
  if (!text) return { ok: false, error: "Write a comment first." }
  if (text.length > COMMENT_MAX) return { ok: false, error: `Comments must be ${COMMENT_MAX} characters or fewer.` }
  return { ok: true, value: text }
}

/**
 * The comment visibility an author may use. Owners always write
 * owner-visible comments; staff choose.
 */
export function commentVisibilityFor(audience: "staff" | "owner", requested: string): SelectionCommentVisibility | null {
  if (audience === "owner") return "owner"
  return isCommentVisibility(requested) ? requested : null
}

/** Whether a comment is shown to this audience. */
export function commentVisibleTo(audience: "staff" | "owner", visibility: SelectionCommentVisibility): boolean {
  return audience === "staff" || visibility === "owner"
}

/** Order ids may only name the selection's own choices, each once, all of them. */
export function validChoiceOrder(currentIds: readonly string[], orderedIds: readonly string[]): boolean {
  if (currentIds.length !== orderedIds.length) return false
  const current = new Set(currentIds)
  const seen = new Set<string>()
  for (const id of orderedIds) {
    if (!current.has(id) || seen.has(id)) return false
    seen.add(id)
  }
  return true
}

/** A choice cannot open its own selection, and the list is de-duplicated. */
export function cleanDependentSelectionIds(ownSelectionId: string, selectionIds: readonly string[]): readonly string[] {
  return [...new Set(selectionIds.map((id) => id.trim()).filter((id) => id && id !== ownSelectionId))]
}
