/*
 * Shared value lists for the budget domain's tables (architecture standard,
 * section 3). Schema columns use them as `enum:` and the budget store checks
 * writes against them.
 */

/**
 * Where an owner pay application's billed amounts come from: entered in
 * Compass, or synced from the progress billing built in Sage (read only in
 * Compass).
 */
export const PAY_APPLICATION_BILLING_SOURCES = ["compass", "sage"] as const

export type PayApplicationBillingSource = (typeof PAY_APPLICATION_BILLING_SOURCES)[number]

/**
 * What a Sage sync did to a pay application: created it from Sage, linked an
 * existing Compass pay application with the same number, refreshed a synced
 * one with Sage's newer amounts, or replaced a linked one's amounts with
 * Sage's when staff chose "Use Sage amounts".
 */
export const PAY_APPLICATION_SAGE_SYNC_EVENTS = ["created", "linked", "refreshed", "sage_amounts_applied"] as const

export type PayApplicationSageSyncEvent = (typeof PAY_APPLICATION_SAGE_SYNC_EVENTS)[number]
