import "server-only"

import { z } from "zod/v4"

import { departmentFromSageJob } from "@/lib/sage/square-payment"
import { envString } from "@/lib/shared/env"

/*
 * Creates and publishes a Square invoice for a simple Compass invoice, in the
 * exact shape the Square payment webhook already recognizes (the same shape
 * scripts/sage_square_invoice_bridge.py creates): the order's reference is
 * "sage-ar-invoice:<Sage record>", the invoice carries "Sage Job" and "Sage
 * Record" custom fields and "Source record N." in its description, and it is
 * published at the Square location named for the job's department. That way
 * the existing webhook posts the processing fee to Sage and reminds staff to
 * enter the receipt, unchanged.
 *
 * Square never emails the customer (delivery SHARE_MANUALLY): Compass emails
 * the invoice PDF and the payment link from the invoice mailbox.
 */

const SQUARE_API_ORIGIN = "https://connect.squareup.com"
const SQUARE_API_VERSION = "2026-08-19"

export function squareInvoiceAccessToken(env: unknown): string | null {
  return envString(env, "SQUARE_PRODUCTION_ACCESS_TOKEN")
}

class SquareInvoiceError extends Error {}

async function squareCall(token: string, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${SQUARE_API_ORIGIN}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_API_VERSION, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
    redirect: "manual",
  })
  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    parsed = null
  }
  const value = z.record(z.string(), z.unknown()).safeParse(parsed)
  if (!response.ok || !value.success) {
    const errors = value.success ? z.array(z.object({ detail: z.string().optional(), code: z.string().optional() })).safeParse(value.data.errors) : null
    const detail = errors?.success ? errors.data.map((error) => error.detail ?? error.code ?? "").filter(Boolean).join("; ") : ""
    if (response.status === 401 || response.status === 403) throw new SquareInvoiceError("Square refused Compass's access token for invoices. Check the Square connection.")
    throw new SquareInvoiceError(`Square ${method} ${path.split("?")[0]} failed (${response.status})${detail ? `: ${detail}` : ""}.`)
  }
  return value.data
}

const locationsSchema = z.object({ locations: z.array(z.object({ id: z.string(), name: z.string().optional(), status: z.string().optional() })).optional() })
const customerSchema = z.object({ id: z.string(), email_address: z.string().optional(), reference_id: z.string().optional() })
const orderSchema = z.object({ id: z.string(), total_money: z.object({ amount: z.number(), currency: z.string() }) })
const invoiceSchema = z.object({ id: z.string(), version: z.number(), status: z.string().optional(), public_url: z.string().optional() })

async function locationId(token: string, name: string): Promise<string> {
  const parsed = locationsSchema.parse(await squareCall(token, "GET", "/v2/locations"))
  const matches = (parsed.locations ?? []).filter((location) => location.status === "ACTIVE" && location.name === name)
  if (matches.length !== 1 || !matches[0]) throw new SquareInvoiceError(`Square needs exactly one active location named ${name}.`)
  return matches[0].id
}

async function findOrCreateCustomer(token: string, input: { readonly email: string; readonly name: string; readonly compassCustomerId: string }): Promise<string> {
  const email = input.email.trim().toLowerCase()
  const reference = `compass-customer:${input.compassCustomerId}`
  const found = await squareCall(token, "POST", "/v2/customers/search", { query: { filter: { email_address: { exact: email } } }, limit: 10 })
  const customers = z.array(customerSchema).catch([]).parse(found.customers ?? []).filter((customer) => customer.email_address?.toLowerCase() === email)
  const chosen = customers.find((customer) => customer.reference_id === reference) ?? (customers.length === 1 ? customers[0] : undefined)
  if (chosen) return chosen.id
  if (customers.length > 1) throw new SquareInvoiceError(`Square has ${customers.length} customers with ${email}; merge them in Square, then try again.`)
  const created = await squareCall(token, "POST", "/v2/customers", {
    // Square allows 45 characters: the customer id plus a short hash of the email.
    idempotency_key: `cc-${input.compassCustomerId.replaceAll("-", "").slice(0, 32)}-${shortHash(email)}`.slice(0, 45),
    company_name: input.name.slice(0, 500),
    email_address: email,
    reference_id: reference,
    note: "Created by Compass for a Square invoice.",
  })
  return customerSchema.parse(created.customer).id
}

function shortHash(value: string): string {
  let hash = 5381
  for (const character of value) hash = ((hash * 33) ^ character.charCodeAt(0)) >>> 0
  return hash.toString(36)
}

type SquareInvoiceLine = { readonly name: string; readonly amountCents: number; readonly note: string | null }

export type CreateSquareInvoiceInput = {
  readonly token: string
  readonly invoiceId: string
  readonly invoiceNumber: string
  /** The Compass project number, which is the Sage job short name the webhook maps back. */
  readonly sageJobShortName: string
  /** Sage's acrinv.recnum for the invoice (the webhook's link to Sage). */
  readonly sageRecordId: string
  readonly invoiceDate: string
  readonly dueDate: string
  readonly today: string
  readonly customer: { readonly email: string; readonly name: string; readonly compassCustomerId: string }
  readonly lines: readonly SquareInvoiceLine[]
  readonly subtotalCents: number
  readonly taxCents: number
  readonly totalCents: number
  readonly acceptBankTransfer: boolean
  /** Progress saved on the invoice from an earlier try. */
  readonly existing: { readonly orderId: string | null; readonly squareInvoiceId: string | null }
  /** Called after each step so a retry resumes instead of starting over. */
  readonly saveProgress: (progress: { readonly orderId?: string; readonly squareInvoiceId?: string; readonly customerId?: string }) => Promise<void>
}

/** Order payload: one unit per line at its amount (Sage's own amounts), with the sales tax as an order-level percentage that reproduces Sage's tax. */
function orderPayload(input: CreateSquareInvoiceInput, location: string, customerId: string): Record<string, unknown> {
  const order: Record<string, unknown> = {
    location_id: location,
    customer_id: customerId,
    reference_id: `sage-ar-invoice:${input.sageRecordId}`,
    line_items: input.lines.map((line) => ({
      name: line.name.slice(0, 512),
      quantity: "1",
      base_price_money: { amount: line.amountCents, currency: "USD" },
      ...(line.note ? { note: line.note.slice(0, 500) } : {}),
    })),
  }
  if (input.taxCents > 0 && input.subtotalCents > 0) {
    const percentage = ((input.taxCents * 100) / input.subtotalCents).toFixed(6).replace(/\.?0+$/, "")
    order.taxes = [{ uid: "sage-sales-tax", name: "Sales tax", type: "ADDITIVE", percentage, scope: "ORDER" }]
  }
  return { idempotency_key: `compass-invoice-order-${input.invoiceId}`.slice(0, 192), order }
}

export type CreatedSquareInvoice = { readonly squareInvoiceId: string; readonly orderId: string; readonly customerId: string; readonly publicUrl: string }

/**
 * Creates (or resumes) the Square order and invoice and publishes it.
 * Idempotency keys come from the Compass invoice id, so a retry after a
 * timeout never makes a second invoice.
 */
export async function createAndPublishSquareInvoice(input: CreateSquareInvoiceInput): Promise<CreatedSquareInvoice> {
  const department = departmentFromSageJob(input.sageJobShortName)
  if (!department) throw new SquareInvoiceError(`Compass can't tell the Square location for job ${input.sageJobShortName}.`)
  const { token } = input
  const location = await locationId(token, department)
  const customerId = await findOrCreateCustomer(token, input.customer)
  await input.saveProgress({ customerId })

  let orderId = input.existing.orderId
  if (!orderId) {
    const payload = orderPayload(input, location, customerId)
    const calculated = orderSchema.parse((await squareCall(token, "POST", "/v2/orders/calculate", { order: payload.order })).order)
    if (calculated.total_money.amount !== input.totalCents) {
      throw new SquareInvoiceError(
        `Square works the total out to ${(calculated.total_money.amount / 100).toFixed(2)} but the invoice is ${(input.totalCents / 100).toFixed(2)} (sales tax rounding). Nothing was created in Square.`
      )
    }
    orderId = orderSchema.parse((await squareCall(token, "POST", "/v2/orders", payload)).order).id
    await input.saveProgress({ orderId })
  }

  let invoice = input.existing.squareInvoiceId
    ? invoiceSchema.parse((await squareCall(token, "GET", `/v2/invoices/${encodeURIComponent(input.existing.squareInvoiceId)}`)).invoice)
    : null
  if (!invoice) {
    const created = await squareCall(token, "POST", "/v2/invoices", {
      idempotency_key: `compass-invoice-${input.invoiceId}`.slice(0, 128),
      invoice: {
        location_id: location,
        order_id: orderId,
        primary_recipient: { customer_id: customerId },
        payment_requests: [{ request_type: "BALANCE", due_date: input.dueDate >= input.today ? input.dueDate : input.today, tipping_enabled: false }],
        accepted_payment_methods: { card: true, bank_account: input.acceptBankTransfer, square_gift_card: false, buy_now_pay_later: false, cash_app_pay: false },
        // Square sends nothing; Compass emails the invoice and the link.
        delivery_method: "SHARE_MANUALLY",
        invoice_number: input.invoiceNumber.slice(0, 20),
        title: input.sageJobShortName.slice(0, 100),
        description: `Invoice ${input.invoiceNumber}. Sage invoice ${input.invoiceNumber}. Source record ${input.sageRecordId}.`,
        sale_or_service_date: input.invoiceDate,
        custom_fields: [
          { label: "Sage Job", value: input.sageJobShortName.slice(0, 255), placement: "ABOVE_LINE_ITEMS" },
          { label: "Sage Record", value: input.sageRecordId, placement: "BELOW_LINE_ITEMS" },
        ],
      },
    })
    invoice = invoiceSchema.parse(created.invoice)
    await input.saveProgress({ squareInvoiceId: invoice.id })
  }
  if (invoice.status === "DRAFT") {
    const published = await squareCall(token, "POST", `/v2/invoices/${encodeURIComponent(invoice.id)}/publish`, {
      version: invoice.version,
      idempotency_key: `compass-invoice-publish-${input.invoiceId}`.slice(0, 128),
    })
    invoice = invoiceSchema.parse(published.invoice)
  }
  if (!invoice.public_url) {
    invoice = invoiceSchema.parse((await squareCall(token, "GET", `/v2/invoices/${encodeURIComponent(invoice.id)}`)).invoice)
  }
  if (!invoice.public_url) throw new SquareInvoiceError("Square published the invoice but hasn't given its payment link yet; try again in a minute.")
  return { squareInvoiceId: invoice.id, orderId, customerId, publicUrl: invoice.public_url }
}

/** Cancels a published, unpaid Square invoice (when the Compass invoice is voided). */
export async function cancelSquareInvoice(token: string, squareInvoiceId: string): Promise<void> {
  const invoice = invoiceSchema.parse((await squareCall(token, "GET", `/v2/invoices/${encodeURIComponent(squareInvoiceId)}`)).invoice)
  if (invoice.status === "CANCELED") return
  if (invoice.status === "DRAFT") {
    await squareCall(token, "DELETE", `/v2/invoices/${encodeURIComponent(squareInvoiceId)}?version=${invoice.version}`)
    return
  }
  await squareCall(token, "POST", `/v2/invoices/${encodeURIComponent(squareInvoiceId)}/cancel`, { version: invoice.version })
}
