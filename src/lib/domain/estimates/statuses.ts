/*
 * Enumerated values for estimates and change orders (architecture standard,
 * section 3). Pure constants with no imports, so the Drizzle schema can type
 * its columns with them.
 */

export const ESTIMATE_STATUSES = [
  "draft",
  "internal_review",
  "signature_pending",
  "accepted",
  "superseded",
  "void",
] as const
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number]

export const CHANGE_ORDER_STATUSES = [
  "draft",
  "submitted",
  "triage",
  "needs_information",
  "pricing",
  "internal_review",
  "approved_for_owner",
  "signature_pending",
  "executed",
  "sage_pending",
  "synced",
  "closed",
  "declined",
  "void",
] as const
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number]

/**
 * How a change order is built; see src/lib/change-orders/kinds.ts. NULL for
 * older recorded change orders.
 */
export const CHANGE_ORDER_KINDS = ["estimate", "description", "replacement", "contract_version"] as const
export type ChangeOrderKind = (typeof CHANGE_ORDER_KINDS)[number]

/**
 * What a change-order row records. A change order changes the contract and
 * needs the owner's acceptance. A variance is a cost-plus cost movement on a
 * cost code: staff approve it, the owner is informed, and it is numbered on
 * its own (V-001). See src/lib/change-orders/variances.ts.
 */
export const CHANGE_ORDER_RECORD_TYPES = ["change_order", "variance"] as const
export type ChangeOrderRecordType = (typeof CHANGE_ORDER_RECORD_TYPES)[number]

/** Lines Compass adds to a variance or change order, recomputed on approval. */
export const CHANGE_ORDER_LINE_DERIVATIONS = ["builder_fee", "insurance"] as const
export type ChangeOrderLineDerivation = (typeof CHANGE_ORDER_LINE_DERIVATIONS)[number]

/**
 * How an owner's acceptance of a change order was recorded outside a signed
 * document: staff upload written approval, staff sign off a verbal approval,
 * or the owner accepts in their own workspace.
 */
export const CHANGE_ORDER_ACCEPTANCE_METHODS = ["written_approval", "staff_signoff", "owner_workspace"] as const
export type ChangeOrderAcceptanceMethod = (typeof CHANGE_ORDER_ACCEPTANCE_METHODS)[number]

// Column -> list maps the store checks before every write.
export const CHANGE_ORDER_LISTS = {
  status: CHANGE_ORDER_STATUSES,
  changeOrderKind: CHANGE_ORDER_KINDS,
  acceptanceMethod: CHANGE_ORDER_ACCEPTANCE_METHODS,
  recordType: CHANGE_ORDER_RECORD_TYPES,
}
export const CHANGE_ORDER_LINE_LISTS = { derivedFrom: CHANGE_ORDER_LINE_DERIVATIONS }
export const CHANGE_ORDER_HISTORY_LISTS = { fromStatus: CHANGE_ORDER_STATUSES, toStatus: CHANGE_ORDER_STATUSES }

/**
 * Every status an estimate row may hold: the workflow ESTIMATE_STATUSES plus
 * legacy values found in live data. "sent" predates the e-signature workflow
 * and no current writer produces it; isEstimateStatus still rejects it, so
 * estimate screens and edit checks treat it exactly as before.
 */
export const STORED_ESTIMATE_STATUSES = [...ESTIMATE_STATUSES, "sent"] as const

/** Store check for estimates: any stored status, so a legacy row can still be rewritten. */
export const ESTIMATE_LISTS = { status: STORED_ESTIMATE_STATUSES }
