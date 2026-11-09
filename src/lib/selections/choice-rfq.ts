/**
 * Pricing selection choices through the normal RFQ flow. Each choice sent to
 * a supplier is one RFQ scope line; the RFQ's procurement link for the
 * selection keeps, in its specification snapshot, which line priced which
 * choice. When the supplier answers (price link, portal or a manually
 * recorded response), the line prices fill the choices' supplier price.
 * Pure: no database or network access.
 */
import type { CreateRfqScopeLineInput } from "@/lib/domain/operations/types"
import type { PortalRfqVendorResponse } from "@/lib/rfqs/portal-response"

export type ChoiceLineRef = { readonly choiceId: string; readonly lineNumber: number }

export type ChoiceForRfq = {
  readonly id: string
  readonly title: string
  readonly description: string | null
  readonly supplierName: string | null
  readonly vendorName: string | null
  readonly productUrl: string | null
}

export type SelectionForRfq = {
  readonly id: string
  readonly roomName: string
  readonly name: string
  readonly quantity: number | null
  /** Catalog cost code and its division; null when the selection's code isn't in the catalog. */
  readonly costCode: string | null
  readonly phaseCode: string | null
  /** The selection's own code when it isn't a catalog code, kept in the line notes. */
  readonly freeTextCostCode: string | null
}

/** One RFQ scope line asking for a choice's price. */
export function choiceRfqScopeLine(selection: SelectionForRfq, choice: ChoiceForRfq): CreateRfqScopeLineInput & { readonly choiceId: string } {
  const notes = [
    choice.description,
    selection.quantity !== null ? `Quantity: ${selection.quantity}` : null,
    choice.vendorName ?? choice.supplierName ? `Supplier: ${choice.vendorName ?? choice.supplierName}` : null,
    choice.productUrl ? `Product: ${choice.productUrl}` : null,
    selection.freeTextCostCode ? `Cost code: ${selection.freeTextCostCode}` : null,
  ].filter((value): value is string => Boolean(value))
  return {
    selectionId: selection.id,
    choiceId: choice.id,
    description: `${selection.roomName}: ${selection.name} - ${choice.title}`,
    costCode: selection.costCode,
    phaseCode: selection.phaseCode,
    notes: notes.length > 0 ? notes.join(" | ") : null,
  }
}

/**
 * Which line prices which choice of `selectionId`. RFQ lines are numbered by
 * their position (1-based), so `firstLineNumber` is the number of the first
 * line in `lines`.
 */
export function choiceLineRefs(
  lines: readonly { readonly selectionId?: string | null; readonly choiceId?: string | null }[],
  selectionId: string,
  firstLineNumber = 1,
): readonly ChoiceLineRef[] {
  return lines.flatMap((line, index) =>
    line.selectionId === selectionId && line.choiceId ? [{ choiceId: line.choiceId, lineNumber: firstLineNumber + index }] : [],
  )
}

/** Earlier refs with the same line number are replaced by the newer ones. */
export function mergeChoiceLineRefs(existing: readonly ChoiceLineRef[], added: readonly ChoiceLineRef[]): readonly ChoiceLineRef[] {
  const taken = new Set(added.map((ref) => ref.lineNumber))
  return [...existing.filter((ref) => !taken.has(ref.lineNumber)), ...added].sort((a, b) => a.lineNumber - b.lineNumber)
}

/** The supplier price (cents) each choice got from a quote. A decline or missing line gives nothing. */
export function choicePricesFromResponse(
  refs: readonly ChoiceLineRef[],
  response: PortalRfqVendorResponse | null,
): readonly { readonly choiceId: string; readonly priceCents: number }[] {
  if (!response || response.decision !== "quote") return []
  const amounts = new Map(response.lines.map((line) => [line.lineNumber, line.amount]))
  return refs.flatMap((ref) => {
    const amount = amounts.get(ref.lineNumber)
    return amount === undefined || !Number.isFinite(amount) || amount < 0 ? [] : [{ choiceId: ref.choiceId, priceCents: Math.round(amount * 100) }]
  })
}
