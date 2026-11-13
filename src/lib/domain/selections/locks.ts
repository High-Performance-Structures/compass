/**
 * Locked selections (owner decision 2026-11-12). Pure: no database access.
 *
 * - Installed: nothing changes. No status change, no change of pick, no edit
 *   of the chosen product, by staff or automation. When the installed item
 *   must be replaced with a different product, staff use "Replace installed
 *   item", which makes a new selection (replacement.ts).
 * - Ordered: the same, except staff (and the daily log) may move it on to
 *   Installed, and staff (only) may mark it Unavailable when the supplier
 *   can't fill it (not an owner change of mind; owner decision 2026-11-12),
 *   which unlocks it to be chosen again. When the owner changes their mind
 *   after purchase, staff use "Owner changed selection after purchase",
 *   which makes a new selection.
 * - Replaced: a selection another one replaces stays on record exactly as it
 *   was, whatever its status.
 *
 * Choices that are not the pick may still be added and edited, and links,
 * photos, comments and notes still work; only the pick and the selection's
 * product fields are fixed.
 */
import type { ProjectSelectionStatus, SelectionReplacementReason } from "./statuses"

export const LOCKED_SELECTION_STATUSES = ["ordered", "installed"] as const satisfies readonly ProjectSelectionStatus[]

export type SelectionLock = {
  readonly kind: "ordered" | "installed" | "replaced"
  /** What staff see when a change is refused. */
  readonly message: string
}

// Staff-only moves out of Ordered: installed, or the supplier can't fill it.
const STAFF_MOVES_FROM_ORDERED: ReadonlySet<ProjectSelectionStatus> = new Set(["installed", "unavailable"])

const ORDERED_MESSAGE =
  "This selection is ordered, so its pick and product are locked. If the owner changed their mind, use \"Owner changed selection after purchase\" to make a new selection."
const INSTALLED_MESSAGE =
  "This selection is installed, so it is locked. If the item must be replaced with a different product, use \"Replace installed item\"."
const REPLACED_MESSAGE = "This selection was replaced by a new one and stays on record as it was. Make changes on the replacement."

/** The lock on a selection with stored `status`, or null when it can change. */
export function selectionLock(status: string, replaced: boolean): SelectionLock | null {
  if (replaced) return { kind: "replaced", message: REPLACED_MESSAGE }
  if (status === "installed") return { kind: "installed", message: INSTALLED_MESSAGE }
  if (status === "ordered") return { kind: "ordered", message: ORDERED_MESSAGE }
  return null
}

/**
 * Why staff may not move a selection from `from` to `to` by hand, or null.
 * An ordered selection may only go on to Installed, or to Unavailable (the
 * supplier can't fill it); an installed or replaced one does not move.
 */
export function staffStatusChangeBlocker(from: string, to: ProjectSelectionStatus, replaced: boolean): string | null {
  if (from === to) return null
  const lock = selectionLock(from, replaced)
  if (!lock) return null
  if (lock.kind === "ordered" && STAFF_MOVES_FROM_ORDERED.has(to)) return null
  return lock.message
}

/** The statuses a staff member may pick from `from` (the status picker's options). */
export function staffStatusChoices(
  from: ProjectSelectionStatus,
  all: readonly ProjectSelectionStatus[],
  replaced: boolean,
): readonly ProjectSelectionStatus[] {
  return all.filter((to) => staffStatusChangeBlocker(from, to, replaced) === null)
}

/**
 * The fields fixed on an ordered selection: the product, and the cost code
 * and phase it is bought and billed under. An installed selection keeps
 * everything but its notes.
 */
const LOCKED_PRODUCT_FIELDS = [
  "Category",
  "Selection",
  "Description",
  "Quantity",
  "Manufacturer",
  "Model",
  "Color / finish",
  "Supplier",
  "Product link",
  "Cost code",
  "Phase",
] as const

/**
 * Why a staff edit (the selection edit form) can't save, or null: an ordered
 * selection's product, cost code and phase are fixed; an installed one
 * changes only its notes; a replaced one doesn't change at all. Status moves
 * only as staffStatusChangeBlocker allows.
 * `changedFields` are the form's field labels.
 */
export function staffEditBlocker(input: {
  readonly status: string
  readonly replaced: boolean
  readonly changedFields: readonly string[]
  readonly statusMove: { readonly from: string; readonly to: ProjectSelectionStatus } | null
}): string | null {
  const lock = selectionLock(input.status, input.replaced)
  if (!lock) return null
  const fields = input.changedFields.filter((field) => field !== "Status")
  const blocked =
    lock.kind === "replaced"
      ? input.changedFields.length > 0
      : lock.kind === "installed"
        ? fields.some((field) => field !== "Notes")
        : fields.some((field) => LOCKED_PRODUCT_FIELDS.some((locked) => locked === field))
  if (blocked) return lock.message
  return input.statusMove ? staffStatusChangeBlocker(input.statusMove.from, input.statusMove.to, input.replaced) : null
}

/**
 * Why a selection with `status` can't be replaced for `reason`, or null.
 * "Replace installed item" needs an installed selection; "Owner changed
 * selection after purchase" an ordered one; "Supplier couldn't fill" an
 * Unavailable one that was marked so from Ordered (`releasedFromOrder`). A
 * selection is replaced once.
 */
export function replacementBlocker(
  status: string,
  replaced: boolean,
  reason: SelectionReplacementReason,
  releasedFromOrder = false,
): string | null {
  if (replaced) return "This selection was already replaced. Make changes on the replacement."
  if (reason === "installed_replaced" && status !== "installed") return "Only an installed selection can be replaced this way."
  if (reason === "owner_changed_after_purchase" && status !== "ordered") return "Only an ordered selection can be changed this way."
  if (reason === "supplier_couldnt_fill" && !(status === "unavailable" && releasedFromOrder)) {
    return "Only a selection marked Unavailable after it was ordered can be replaced this way."
  }
  return null
}

/** The status the new selection starts in: a product chosen is proposed; none yet, needed. */
export function replacementStartStatus(hasPick: boolean): ProjectSelectionStatus {
  return hasPick ? "proposed" : "needed"
}

/**
 * The one line a replacement's draft change order starts with (owner
 * decision 2026-11-12): for Replace and "supplier couldn't fill", the new
 * pick's full owner price when known, else $0; for an owner change, $0.
 * Staff then edit the change order's amounts on the change-order screens.
 */
export function replacementLineAmount(reason: SelectionReplacementReason, pickOwnerPriceCents: number | null): number {
  return reason === "owner_changed_after_purchase" ? 0 : (pickOwnerPriceCents ?? 0)
}

export function replacementLineDescription(selectionName: string, pickTitle: string | null, label: string): string {
  return `${selectionName}: ${pickTitle ?? "new selection to be made"} (${label.toLocaleLowerCase()})`.slice(0, 500)
}

/** How each replacement reason reads to staff and on the change order. */
export const REPLACEMENT_REASON_LABELS: Readonly<Record<SelectionReplacementReason, string>> = {
  installed_replaced: "Installed item replaced",
  owner_changed_after_purchase: "Owner changed selection after purchase",
  supplier_couldnt_fill: "Supplier couldn't fill the order",
}

/**
 * Whether a selection in a Selection Phase is outside the phase's work: it
 * is ordered, installed or replaced, or the owner's approval is recorded
 * without a signature on its current pick (an older approval). Those are
 * left out of the phase document, its progress and its change order, so
 * nothing is billed twice and a phase never waits on them.
 *
 * Older approvals are selections imported already approved (Buildertrend):
 * the owner agreed to them and they were billed there, so a Selection Phase
 * must not sign or bill them again. Their pick can't change either (an
 * approved selection changes only by change order; pickChangeBlocker).
 */
export function outsidePhaseWork(row: {
  readonly status: string
  readonly replaced: boolean
  readonly ownerApproved: boolean
  /** A signed Selection Phase covers its current pick. */
  readonly signedCurrentPick: boolean
}): boolean {
  return row.status === "ordered" || row.status === "installed" || row.replaced || (row.ownerApproved && !row.signedCurrentPick)
}

export const APPROVED_PICK_MESSAGE = "This selection is approved. Use a change order to change it."
export const OUT_FOR_SIGNATURE_MESSAGE = "This selection is out for signature."
