import { z } from "zod/v4"

import { PROJECT_DEPARTMENTS } from "@/lib/domain/project/statuses"

/*
 * Settings > Workflows > Simple invoices: invoices built in Compass for
 * material sales and one-off work (not progress billing, which is built in
 * Sage or as pay requests). Pure and client-safe, so the settings form and
 * the invoice editor share it. Sage coding (income accounts, invoice type and
 * status, due days) comes from Settings > Workflows > Sage AR invoices; the
 * invoice numbers from Settings > Workflows > Sage export.
 */

const department = z.enum(PROJECT_DEPARTMENTS)

/** Default for emailResendWindowMinutes (owner decision 2026-11-12). */
const DEFAULT_EMAIL_RESEND_WINDOW_MINUTES = 2
const MAX_EMAIL_RESEND_WINDOW_MINUTES = 60
const optionalEmail = z.union([z.literal(""), z.email()])

export const simpleInvoiceSettingsSchema = z.object({
  /**
   * The mailbox every invoice email is sent from (a Google Workspace mailbox
   * Compass may send as). Empty: the sending staff member's own mailbox.
   */
  senderAddress: optionalEmail,
  senderName: z.string().trim().max(80),
  /**
   * Departments whose jobs don't use a contract budget, so invoices are made
   * from the job's estimate (in part or in full) instead.
   */
  estimateInvoiceDepartments: z.array(department).max(PROJECT_DEPARTMENTS.length),
  /** Departments whose invoices are material sales (numbered with the material sale format). */
  materialSaleDepartments: z.array(department).max(PROJECT_DEPARTMENTS.length),
  /** Departments whose deposit invoices may not go through Square (check or wire only). */
  squareBlockedDepositDepartments: z.array(department).max(PROJECT_DEPARTMENTS.length),
  /** Let customers pay a Square invoice by bank transfer (ACH) as well as card. */
  squareAcceptBankTransfer: z.boolean(),
  /**
   * After an invoice is emailed, another send of the same invoice is refused
   * for this many minutes (a double click, or two staff at once).
   */
  emailResendWindowMinutes: z.number().int().min(1).max(MAX_EMAIL_RESEND_WINDOW_MINUTES),
})

export type SimpleInvoiceSettings = z.infer<typeof simpleInvoiceSettingsSchema>

const DEFAULT_SIMPLE_INVOICE_SETTINGS: SimpleInvoiceSettings = {
  senderAddress: "",
  senderName: "",
  estimateInvoiceDepartments: ["N"],
  materialSaleDepartments: ["N"],
  squareBlockedDepositDepartments: ["H", "O"],
  squareAcceptBankTransfer: true,
  emailResendWindowMinutes: DEFAULT_EMAIL_RESEND_WINDOW_MINUTES,
}

export const SIMPLE_INVOICE_SETTINGS_GROUP = {
  label: "Simple invoices",
  description:
    "Invoices built in Compass for material sales and one-off work: the mailbox they are emailed from, how soon one may be emailed again, which departments invoice from the job's estimate, and when Square may be used.",
  defaults: DEFAULT_SIMPLE_INVOICE_SETTINGS,
  schema: simpleInvoiceSettingsSchema,
}
