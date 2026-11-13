/**
 * Owner-suggested choices (owner decision 2026-11-13). Pure and client-safe.
 *
 * On a selection published to them, an owner can "Add my own choice": a
 * name, an optional product link and a note. The link's page fills in the
 * image and the supplier price, never the owner price: the choice shows
 * "Pending staff pricing" until staff set the owner price (supplier price
 * plus markup) the normal way. The owner can pick it like any other choice,
 * and edit or delete it until staff price it. A Selection Phase can't go
 * out for signature while a picked choice is still pending.
 */
import { normalizeSupplierUrl } from "@/lib/selections/link-preview"

export const OWNER_SUGGESTION_NAME_MAX = 200
export const OWNER_SUGGESTION_NOTE_MAX = 4000
/** Pending (not yet priced) suggestions one owner may have on one selection. */
export const OWNER_PENDING_SUGGESTIONS_MAX = 5
export const OWNER_SUGGESTION_CAP_MESSAGE = `You already have ${OWNER_PENDING_SUGGESTIONS_MAX} suggestions waiting for your builder to price on this selection. Delete one, or wait until they are priced.`

export type OwnerSuggestionInput = {
  readonly name: string
  /** A product page; blank for none. */
  readonly url: string
  readonly note: string
}

export type ParsedOwnerSuggestion = {
  readonly title: string
  readonly url: string | null
  readonly description: string | null
}

export function parseOwnerSuggestion(input: OwnerSuggestionInput): { readonly ok: true; readonly value: ParsedOwnerSuggestion } | { readonly ok: false; readonly error: string } {
  const title = input.name.trim()
  if (!title) return { ok: false, error: "Give your choice a name." }
  if (title.length > OWNER_SUGGESTION_NAME_MAX) return { ok: false, error: `The name must be ${OWNER_SUGGESTION_NAME_MAX} characters or fewer.` }
  const note = input.note.trim()
  if (note.length > OWNER_SUGGESTION_NOTE_MAX) return { ok: false, error: `The note must be ${OWNER_SUGGESTION_NOTE_MAX} characters or fewer.` }
  const rawUrl = input.url.trim()
  const url = rawUrl ? normalizeSupplierUrl(rawUrl) : null
  if (rawUrl && !url) return { ok: false, error: "Enter a web address that starts with http:// or https://." }
  return { ok: true, value: { title, url, description: note || null } }
}

/** The to-do title's subject: "Backsplash — Hex tile". */
export function ownerSuggestionTodoSubject(selectionName: string, choiceTitle: string): string {
  return `${selectionName} — ${choiceTitle}`
}

/** The owner may edit or delete this suggestion: their own, not yet priced by staff. */
export function ownerCanChangeSuggestion(choice: { readonly suggestedByViewer: boolean; readonly ownerPricingPending: boolean }): boolean {
  return choice.suggestedByViewer && choice.ownerPricingPending
}

/**
 * Why a Selection Phase can't go out for signature because of a picked
 * choice still waiting for staff pricing, or null.
 */
export function pendingPricingBlocker(lines: readonly { readonly selectionName: string; readonly choiceTitle: string | null; readonly ownerPricingPending: boolean }[]): string | null {
  const pending = lines.find((line) => line.ownerPricingPending)
  if (!pending) return null
  return `${pending.selectionName}: the owner's suggested choice${pending.choiceTitle ? ` "${pending.choiceTitle}"` : ""} is still pending staff pricing. Set its owner price before sending for signature.`
}
