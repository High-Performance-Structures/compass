/*
 * Enumerated values for company status settings (architecture standard,
 * section 3). Pure constants with no imports, so the Drizzle schema can type
 * its columns with them.
 */

/**
 * The record types whose statuses a company manages in Settings › Statuses.
 * Adding one: its key here, plus its entry in RECORD_STATUS_REGISTRY
 * (./registry.ts); TypeScript requires the pair.
 */
export const RECORD_STATUS_TYPES = ["purchase_order", "rfq", "rfi", "todo"] as const
export type RecordStatusType = (typeof RECORD_STATUS_TYPES)[number]

/** What a status counts as. "Open" on a list's filter buttons is the open group. */
export const RECORD_STATUS_GROUPS = ["open", "closed", "void"] as const
export type RecordStatusGroup = (typeof RECORD_STATUS_GROUPS)[number]

/** Status color tokens; each maps to theme colors in the status badge. */
export const RECORD_STATUS_COLORS = ["gray", "blue", "green", "orange", "red"] as const
export type RecordStatusColor = (typeof RECORD_STATUS_COLORS)[number]
