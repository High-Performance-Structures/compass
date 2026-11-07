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

export const PAY_APPLICATION_SETTINGS_GROUP = {
  label: "Pay applications",
  description: "How much detail the client sees on a pay application. Staff can choose a different level on any draw.",
  defaults: { ownerDetail: "division_percent" },
  schema: payApplicationSettingsSchema,
} satisfies { readonly defaults: PayApplicationSettings; readonly [key: string]: unknown }

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

/** Sage 100 Contractor accepts invoice numbers up to this many characters. */
export const SAGE_INVOICE_NUMBER_MAX_LENGTH = 20

/** Every invoice number format needs the document's own number: {n} or {n:2}. */
const SAGE_NUMBER_TOKEN = /\{n(?::\d)?\}/

const sageInvoiceFormat = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((value) => SAGE_NUMBER_TOKEN.test(value), "Include {n} (or {n:2} for two digits) for the document's number.")

/**
 * The Sage export: billing cycle and invoice number formats Compass suggests
 * when a document goes to Sage. Tokens: {project} is the project number, {job}
 * the Sage job number, {n} the document's number and {n:2} that number padded
 * to two digits.
 */
export const sageExportSettingsSchema = z.object({
  billingCycle: z.string().trim().min(1).max(10),
  payRequestInvoiceFormat: sageInvoiceFormat,
  depositInvoiceFormat: sageInvoiceFormat,
  otherBillingInvoiceFormat: sageInvoiceFormat,
  creditMemoInvoiceFormat: sageInvoiceFormat,
  materialSaleInvoiceFormat: sageInvoiceFormat,
})

export type SageExportSettings = z.infer<typeof sageExportSettingsSchema>

export const DEFAULT_SAGE_EXPORT_SETTINGS: SageExportSettings = {
  billingCycle: "1MO",
  payRequestInvoiceFormat: "{project}-PR{n:2}",
  depositInvoiceFormat: "{project}-DEP{n}",
  otherBillingInvoiceFormat: "{project}-INV{n:2}",
  creditMemoInvoiceFormat: "{project}-CM{n:2}",
  materialSaleInvoiceFormat: "{project}-S{n:2}",
}

export const SAGE_EXPORT_SETTINGS_GROUP = {
  label: "Sage export",
  description:
    "The billing cycle and invoice number formats Compass suggests when a pay request or other billing goes to Sage. Sage allows invoice numbers up to 20 characters.",
  defaults: DEFAULT_SAGE_EXPORT_SETTINGS,
  schema: sageExportSettingsSchema,
}
