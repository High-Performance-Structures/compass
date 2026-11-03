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

// Column -> list maps the store checks before every write.
export const CHANGE_ORDER_LISTS = { status: CHANGE_ORDER_STATUSES, changeOrderKind: CHANGE_ORDER_KINDS }
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
