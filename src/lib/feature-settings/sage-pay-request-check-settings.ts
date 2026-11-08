import { z } from "zod/v4"

import { INVOICE_DATE_SOURCES } from "@/lib/feature-settings/sage-ar-invoice-settings"

/*
 * Settings > Workflows > Sage pay request check: for a company whose pay
 * requests are created in Sage, the "Enter in Sage" checklist shown on each
 * pay request and the check of the AR invoice Sage creates when the billing
 * is posted. Pure and client-safe.
 */

/** Tokens: {month} {year} {n} {project}. */
const DESCRIPTION_TOKEN = /\{(month|year|n|project)\}/

export const sagePayRequestCheckSettingsSchema = z.object({
  /** The progress billing description staff type in Sage, e.g. "November 2026 Pay Request". */
  descriptionFormat: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .refine((value) => DESCRIPTION_TOKEN.test(value), "Include {month} or {n}."),
  /** The billing date: the pay request's period end, or the day it was approved for billing. */
  billingDate: z.enum(INVOICE_DATE_SOURCES),
  /** How far Sage's sales tax may differ from Compass's, in cents per taxable line. */
  taxToleranceCentsPerLine: z.number().int().min(0).max(100),
  /** Notify office staff with finance access when a posted invoice needs attention. */
  notifyOnNeedsAttention: z.boolean(),
})

export type SagePayRequestCheckSettings = z.infer<typeof sagePayRequestCheckSettingsSchema>

const DEFAULT_SAGE_PAY_REQUEST_CHECK_SETTINGS: SagePayRequestCheckSettings = {
  descriptionFormat: "{month} {year} Pay Request",
  billingDate: "period_end",
  taxToleranceCentsPerLine: 1,
  notifyOnNeedsAttention: true,
}

export const SAGE_PAY_REQUEST_CHECK_SETTINGS_GROUP = {
  label: "Sage pay request check",
  description:
    "When pay requests are created in Sage: the Enter in Sage checklist on each pay request (invoice number, description, taxable lines, change order lines, expected totals) and the check of the AR invoice Sage creates when the billing is posted.",
  defaults: DEFAULT_SAGE_PAY_REQUEST_CHECK_SETTINGS,
  schema: sagePayRequestCheckSettingsSchema,
}
