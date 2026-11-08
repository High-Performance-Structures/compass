import { z } from "zod/v4"

import { PROJECT_DEPARTMENTS } from "@/lib/domain/project/statuses"

/*
 * Settings > Workflows > Sage AR invoices: how a billed Compass pay request
 * goes to Sage 100 Contractor as an AR invoice (ARInvoiceAddRq). Pure and
 * client-safe, so the settings form and the pay request preview share it.
 *
 * Sage has no progress-billing request in its API, so each billed pay request
 * becomes a Sage AR invoice: this period's billing by cost code, with the
 * period's retention. Posting in Sage stays with the office.
 */

/** A Sage general ledger account number (lgract.recnum), or null when not chosen. */
const ledgerAccount = z.number().int().min(1).max(9_999_999_999).nullable()

/** Tokens: {month} {year} {n} {project}. */
const DESCRIPTION_TOKEN = /\{(month|year|n|project)\}/

/** Tokens: {costCode} the cost code's name, {changeOrder} "CO #14" or "V-006". */
const CHANGE_ORDER_TOKEN = /\{changeOrder\}/

export const INVOICE_DATE_SOURCES = ["period_end", "billed_date"] as const
export type InvoiceDateSource = (typeof INVOICE_DATE_SOURCES)[number]

export const sageArInvoiceSettingsSchema = z.object({
  /**
   * Send each pay request to Sage as an AR invoice when staff approve it for
   * billing. Only applies when pay requests are created in Compass.
   */
  sendBilledPayRequests: z.boolean(),
  /** Sage's invoice type number (acrinv.invtyp); 1 is Contract in the standard setup. */
  invoiceType: z.number().int().min(0).max(99),
  /** Sage's invoice status number (acrinv.status); 1 is Open in the standard setup. */
  invoiceStatus: z.number().int().min(0).max(5),
  /** The invoice date: the pay request's period end, or the day it was approved for billing. */
  invoiceDate: z.enum(INVOICE_DATE_SOURCES),
  /** Days from the invoice date to the due date (payment terms). */
  dueDays: z.number().int().min(0).max(365),
  descriptionFormat: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => DESCRIPTION_TOKEN.test(value), "Include {n} or {month}."),
  changeOrderLineFormat: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => CHANGE_ORDER_TOKEN.test(value), "Include {changeOrder}."),
  /** Income account for every line when the job's department has none of its own. */
  incomeAccount: ledgerAccount,
  /** Income account per department (O, H, N, D); null uses the default above. */
  departmentIncomeAccounts: z.object({ O: ledgerAccount, H: ledgerAccount, N: ledgerAccount, D: ledgerAccount }),
  /** Account for the "deposit applied" line (the contract deposits liability). */
  depositAccount: ledgerAccount,
})

export type SageArInvoiceSettings = z.infer<typeof sageArInvoiceSettingsSchema>

const DEFAULT_SAGE_AR_INVOICE_SETTINGS: SageArInvoiceSettings = {
  // Off by default: AR invoices are for simple invoices; progress billing stays in Sage or Compass.
  sendBilledPayRequests: false,
  invoiceType: 1,
  invoiceStatus: 1,
  invoiceDate: "period_end",
  dueDays: 30,
  descriptionFormat: "{month} {year} Pay Request #{n}",
  changeOrderLineFormat: "{costCode} + {changeOrder}",
  incomeAccount: null,
  departmentIncomeAccounts: { O: null, H: null, N: null, D: null },
  depositAccount: null,
}

export const SAGE_AR_INVOICE_SETTINGS_GROUP = {
  label: "Sage AR invoices",
  description:
    "Whether a pay request approved for billing goes to Sage as an AR invoice (this period's billing by cost code, with retention), and how it is dated, described and coded. Posting in Sage stays with the office.",
  defaults: DEFAULT_SAGE_AR_INVOICE_SETTINGS,
  schema: sageArInvoiceSettingsSchema,
}

/** The income account for a job in this department, or null when none is chosen. */
export function incomeAccountFor(settings: SageArInvoiceSettings, department: string | null): number | null {
  const own = PROJECT_DEPARTMENTS.find((value) => value === department)
  return (own ? settings.departmentIncomeAccounts[own] : null) ?? settings.incomeAccount
}
