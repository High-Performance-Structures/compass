import type {
  ChangeOrderAcceptanceMethod,
  ChangeOrderKind,
  ChangeOrderStatus,
} from "@/lib/domain/estimates/statuses"
import type { ChangeOrderAcceptanceSettings } from "@/lib/feature-settings/contract-settings"
import { formatDate, parseDateOnly } from "@/lib/format"
import { cleanText } from "@/lib/shared/guards"

/*
 * Recording an owner's acceptance of a change order without a signed change
 * order: "written approval" (staff save the owner's email or message as
 * evidence) or "staff sign-off" (a verbal or in-person approval, no
 * document). Either executes the change order. Pure rules; the estimates
 * domain module (change-order-acceptance.ts) applies them.
 */

/** Statuses before execution that can still take an acceptance (not declined or void). */
const OPEN_STATUSES: ReadonlySet<ChangeOrderStatus> = new Set([
  "draft",
  "submitted",
  "triage",
  "needs_information",
  "pricing",
  "internal_review",
  "approved_for_owner",
  "signature_pending",
])

const ACCEPTANCE_METHOD_LABELS: Readonly<Record<ChangeOrderAcceptanceMethod, string>> = {
  written_approval: "written approval",
  staff_signoff: "staff sign-off",
  owner_workspace: "accepted in the owner workspace",
}

/** A change order that changes the contract price. An unpriced one (amount not set) counts as priced. */
export function isPricedChangeOrder(input: {
  readonly kind: ChangeOrderKind | null
  readonly amountCents: number | null
}): boolean {
  if (input.kind === "description") return false
  return input.amountCents !== 0
}

export type ManualAcceptanceAvailability = {
  readonly writtenApproval: boolean
  readonly staffSignOff: boolean
  /** Why staff sign-off can't be used here; null when it can. */
  readonly staffSignOffBlocker: string | null
}

/**
 * Which acceptance routes this user may use on this change order, or null
 * when the change order can't be accepted manually at all. Change orders
 * priced with an estimate are accepted on their estimate, and baseline
 * replacements through the guarded rebaseline action.
 */
export function manualAcceptanceAvailability(input: {
  readonly status: ChangeOrderStatus
  readonly kind: ChangeOrderKind | null
  readonly budgetTreatment: string
  readonly amountCents: number | null
  readonly internal: boolean
  readonly canApprove: boolean
  readonly isAdmin: boolean
  readonly settings: ChangeOrderAcceptanceSettings
}): ManualAcceptanceAvailability | null {
  if (!input.internal || !input.canApprove || !OPEN_STATUSES.has(input.status)) return null
  if (input.budgetTreatment === "baseline_replacement") return null
  if (input.kind === "estimate" || input.kind === "replacement" || input.kind === "contract_version") return null
  const priced = isPricedChangeOrder(input)
  let staffSignOffBlocker: string | null = null
  if (input.settings.staffSignOff === "nobody") {
    staffSignOffBlocker = "Staff sign-off is turned off in Settings › Workflows › Change-order acceptance."
  } else if (input.settings.staffSignOff === "admins" && !input.isAdmin) {
    staffSignOffBlocker = "Only admins can record a staff sign-off."
  } else if (priced && input.settings.pricedRequiresEvidence) {
    staffSignOffBlocker = "A change order that changes the price needs the owner's written approval."
  }
  return { writtenApproval: true, staffSignOff: staffSignOffBlocker === null, staffSignOffBlocker }
}

export type ManualAcceptanceInput = {
  readonly method: string
  /** A project contact who approved; or a typed name below. */
  readonly acceptedByContactId: string | null
  readonly acceptedByName: string | null
  /** YYYY-MM-DD */
  readonly acceptedOn: string
  readonly note: string | null
  /** Staff sign-off: "I approve recording this change order as accepted." */
  readonly confirmed: boolean
  /** Written approval: the saved owner email or message. */
  readonly evidence: { readonly url: string; readonly label: string } | null
}

type CleanCommon = {
  readonly acceptedByContactId: string | null
  readonly acceptedByName: string | null
  readonly acceptedOn: string
}

type CleanManualAcceptance =
  | (CleanCommon & {
      readonly method: "written_approval"
      readonly note: string | null
      readonly evidence: { readonly url: string; readonly label: string }
    })
  | (CleanCommon & { readonly method: "staff_signoff"; readonly note: string })

type Validation =
  | { readonly success: true; readonly value: CleanManualAcceptance }
  | { readonly success: false; readonly error: string }

function limited(value: string | null, max: number): string | null | undefined {
  const cleaned = cleanText(value)
  if (cleaned && cleaned.length > max) return undefined
  return cleaned
}

/** The approval date as YYYY-MM-DD: a real calendar date, not after `today` (YYYY-MM-DD). */
export function acceptanceDateError(value: string, today: string): string | null {
  const cleaned = value.trim()
  if (!parseDateOnly(cleaned)) return "Enter the date the owner approved."
  if (cleaned > today) return "The approval date can't be in the future."
  return null
}

export function validateManualAcceptance(input: ManualAcceptanceInput, today: string): Validation {
  if (input.method !== "written_approval" && input.method !== "staff_signoff") {
    return { success: false, error: "Choose how the owner approved." }
  }
  const dateError = acceptanceDateError(input.acceptedOn, today)
  if (dateError) return { success: false, error: dateError }
  const acceptedByContactId = cleanText(input.acceptedByContactId)
  const acceptedByName = limited(input.acceptedByName, 200)
  if (acceptedByName === undefined) return { success: false, error: "The approver's name must be 200 characters or fewer." }
  if (!acceptedByContactId && !acceptedByName) {
    return { success: false, error: "Choose who approved the change order." }
  }
  const note = limited(input.note, 2_000)
  if (note === undefined) return { success: false, error: "The note must be 2,000 characters or fewer." }
  const common = { acceptedByContactId, acceptedByName, acceptedOn: input.acceptedOn.trim() }
  if (input.method === "staff_signoff") {
    if (!input.confirmed) {
      return { success: false, error: "Confirm that you approve recording this change order as accepted." }
    }
    if (!note) return { success: false, error: "Add a note saying how the owner approved." }
    return { success: true, value: { ...common, method: "staff_signoff", note } }
  }
  const url = cleanText(input.evidence?.url ?? null)
  const label = limited(input.evidence?.label ?? null, 200)
  if (!url) return { success: false, error: "Upload or choose the owner's written approval." }
  if (!label) return { success: false, error: "Name the written approval document." }
  return { success: true, value: { ...common, method: "written_approval", note, evidence: { url, label } } }
}

/** "Accepted by Pat Owner on Nov 6, 2026 (staff sign-off by Sam Staff)". */
export function changeOrderAcceptanceSummary(input: {
  readonly method: ChangeOrderAcceptanceMethod
  readonly acceptedByName: string
  readonly acceptedOn: string
  readonly recordedByName: string | null
}): string {
  const how =
    input.method === "staff_signoff" && input.recordedByName
      ? `staff sign-off by ${input.recordedByName}`
      : ACCEPTANCE_METHOD_LABELS[input.method]
  return `Accepted by ${input.acceptedByName} on ${formatDate(input.acceptedOn)} (${how})`
}
