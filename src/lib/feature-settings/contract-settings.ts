import { z } from "zod/v4"

import { PAY_APPLICATION_OWNER_DETAILS } from "@/lib/financials/pay-application-detail"

/*
 * Company settings for contract workflows: deposits, pay applications and
 * change-order acceptance. Registered in ./registry.ts.
 */

/** Contract deposits: how a received deposit reaches pay applications. */
export const contractDepositSettingsSchema = z.object({
  /** New pay applications apply the unapplied deposit balance automatically. */
  autoApplyToPayApplications: z.boolean(),
})

export type ContractDepositSettings = z.infer<typeof contractDepositSettingsSchema>

export const payApplicationSettingsSchema = z.object({
  /** What the client sees on a pay application unless the draw overrides it. */
  ownerDetail: z.enum(PAY_APPLICATION_OWNER_DETAILS),
})

export type PayApplicationSettings = z.infer<typeof payApplicationSettingsSchema>

/** Who may record a verbal (no-document) owner approval as a staff sign-off. */
export const CHANGE_ORDER_STAFF_SIGNOFF_ROLES = ["approvers", "admins", "nobody"] as const

/** Change-order acceptance: how staff may record an owner's approval without a signed document. */
export const changeOrderAcceptanceSettingsSchema = z.object({
  staffSignOff: z.enum(CHANGE_ORDER_STAFF_SIGNOFF_ROLES),
  /** A change order that changes the price needs written evidence of the approval. */
  pricedRequiresEvidence: z.boolean(),
})

export type ChangeOrderAcceptanceSettings = z.infer<typeof changeOrderAcceptanceSettingsSchema>

export const DEFAULT_CHANGE_ORDER_ACCEPTANCE_SETTINGS: ChangeOrderAcceptanceSettings = {
  staffSignOff: "approvers",
  pricedRequiresEvidence: true,
}
