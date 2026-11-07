import { z } from "zod/v4"

import { PROJECT_CONTRACT_TYPES } from "@/lib/domain/project/statuses"
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

export const CONTRACT_DEPOSIT_SETTINGS_GROUP = {
  label: "Contract deposits",
  description:
    "Whether new pay applications automatically apply the contract deposit that hasn't been applied yet. Staff can change the amount on any draft pay application.",
  defaults: { autoApplyToPayApplications: true },
  schema: contractDepositSettingsSchema,
}

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

/** Where a variance's or change order's liability insurance rate comes from. */
export const INSURANCE_RATE_SOURCES = ["contract", "fixed", "off"] as const

/**
 * Variances and contract types: the contract type a job uses until staff set
 * its own, and how project liability insurance follows variances and change
 * orders ("contract" uses the job's own insurance line as a share of the rest
 * of the contract; "fixed" uses the percent below).
 */
export const varianceSettingsSchema = z.object({
  defaultContractType: z.enum(PROJECT_CONTRACT_TYPES),
  insuranceCostCode: z.string().trim().min(1).max(80),
  insuranceDescription: z.string().trim().min(1).max(120),
  insuranceRateSource: z.enum(INSURANCE_RATE_SOURCES),
  insuranceRatePercent: z.number().min(0).max(100),
})

export type VarianceSettings = z.infer<typeof varianceSettingsSchema>

export const DEFAULT_VARIANCE_SETTINGS: VarianceSettings = {
  defaultContractType: "cost_plus_fixed_fee",
  insuranceCostCode: "00 73 16",
  insuranceDescription: "Project Liability Insurance",
  insuranceRateSource: "contract",
  insuranceRatePercent: 0,
}

export const VARIANCE_SETTINGS_GROUP = {
  label: "Variances",
  description:
    "The contract type a job uses until staff set its own on the Information page, and how project liability insurance is added to variances and change orders.",
  defaults: DEFAULT_VARIANCE_SETTINGS,
  schema: varianceSettingsSchema,
}
