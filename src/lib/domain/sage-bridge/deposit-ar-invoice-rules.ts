import type { ArInvoicePlan } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { addDays } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { sageDescription } from "@/lib/domain/sage-bridge/change-order-rules"

/*
 * A Compass deposit request as its own Sage 100 Contractor AR invoice
 * (<job>-DEP1). Pure: the deposits panel, the writer request and the tests
 * share it. One line for the requested amount on the company's deposit
 * account (the same account the "deposit applied" line on a pay request's
 * invoice uses), no cost code, never taxable. Amounts are cents.
 */

const SAGE_HEADER_DESCRIPTION_MAX = 50
const SAGE_LINE_DESCRIPTION_MAX = 75

export type DepositSagePlanInput = {
  readonly invoiceNumber: { readonly value: string; readonly error: string | null }
  /** The day the deposit was requested (the invoice date). */
  readonly requestedAt: string | null
  /** The request's own due date; null uses the company's payment terms. */
  readonly dueDate: string | null
  readonly dueDays: number
  readonly amountCents: number
  readonly depositAccount: number | null
  readonly sageJobNumber: string | null
}

/** Plans the AR invoice for a deposit request; blockers say why it can't go to Sage yet. */
export function planDepositForSage(input: DepositSagePlanInput): ArInvoicePlan {
  const blockers: string[] = []
  if (!input.sageJobNumber) blockers.push("The project isn't linked to a Sage job. Link it (or send it to Sage) from the project Overview.")
  if (input.invoiceNumber.error) blockers.push(input.invoiceNumber.error)
  const invoiceDate = input.requestedAt && /^\d{4}-\d{2}-\d{2}/.test(input.requestedAt) ? input.requestedAt.slice(0, 10) : null
  if (!invoiceDate) blockers.push("The deposit request has no request date for the invoice date.")
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) blockers.push("The deposit request has no amount.")
  if (input.depositAccount === null) blockers.push("Choose the Sage deposit account in Settings › Workflows › Sage AR invoices.")
  const number = input.invoiceNumber.value
  const description = sageDescription(`Deposit ${number}`.trim(), SAGE_HEADER_DESCRIPTION_MAX)
  const ownDue = input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) && invoiceDate && input.dueDate >= invoiceDate ? input.dueDate : null
  const amountCents = Number.isInteger(input.amountCents) ? input.amountCents : 0
  return {
    invoiceNumber: number,
    invoiceDate,
    dueDate: ownDue ?? (invoiceDate ? addDays(invoiceDate, input.dueDays) : null),
    description,
    lines: [
      {
        key: "deposit",
        kind: "deposit",
        costCode: null,
        description: sageDescription("Contract deposit", SAGE_LINE_DESCRIPTION_MAX),
        taxable: false,
        amountCents,
        billedCents: amountCents,
        sageCostCodeRecord: null,
        sageCostCodeName: null,
        accountNumber: input.depositAccount,
      },
    ],
    linesTotalCents: amountCents,
    taxableCents: 0,
    expectedSalesTaxCents: 0,
    taxDistrict: null,
    retentionCents: 0,
    netDueCents: amountCents,
    currentPaymentDueCents: amountCents,
    blockers,
  }
}
