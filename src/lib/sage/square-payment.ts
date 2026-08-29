import { and, eq } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { sageSquarePaymentOperations } from "@/db/schema-sage"

export const SQUARE_API_VERSION = "2026-08-19"
export const SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER = 10000
export const SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER = 62020

const SQUARE_API_ORIGIN = "https://connect.squareup.com"
const SQUARE_WEBHOOK_PROCESSING_LEASE_MS = 10 * 60 * 1000

const moneySchema = z.object({
  amount: z.number().int(),
  currency: z.string(),
})

const processingFeeSchema = z.object({
  amount_money: moneySchema,
})

const paymentSchema = z.object({
  id: z.string().min(1),
  order_id: z.string().min(1),
  location_id: z.string().min(1),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  amount_money: moneySchema,
  total_money: moneySchema,
  tip_money: moneySchema.optional(),
  processing_fee: z.array(processingFeeSchema).optional(),
  refunded_money: moneySchema.optional(),
})

const tenderSchema = z.object({
  id: z.string().min(1),
  payment_id: z.string().min(1).optional(),
  location_id: z.string().min(1),
  amount_money: moneySchema,
})

const orderSchema = z.object({
  id: z.string().min(1),
  location_id: z.string().min(1),
  reference_id: z.string().min(1),
  tenders: z.array(tenderSchema).optional(),
})

const invoiceSchema = z.object({
  id: z.string().min(1),
  location_id: z.string().min(1),
  order_id: z.string().min(1),
  invoice_number: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.string(),
  created_at: z.string(),
  custom_fields: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
      })
    )
    .optional(),
})

export const squareWebhookEventSchema = z.object({
  merchant_id: z.string().min(1),
  location_id: z.string().optional(),
  type: z.string().min(1),
  event_id: z.string().min(1),
  created_at: z.string(),
  data: z.object({
    id: z.string().optional(),
    object: z.unknown(),
  }),
})

const receiptPayloadSchema = z.object({
  operationType: z.literal("post_square_receipt"),
  company: z.literal("High Performance Structures Inc"),
  squarePaymentId: z.string(),
  squareInvoiceId: z.string(),
  squareOrderId: z.string(),
  squareLocationId: z.string(),
  department: z.enum(["HPS", "ORC", "Nu-Tech"]),
  sageInvoiceId: z.string(),
  sageInvoiceNumber: z.string(),
  ownerPaymentCents: z.number().int().positive(),
  clientPaidFeeCents: z.number().int().nonnegative(),
  currency: z.literal("USD"),
  depositAccountNumber: z.literal(SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER),
  merchantFeeAccountNumber: z.literal(
    SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER
  ),
  paymentCompletedAt: z.string(),
})

const feePayloadSchema = z.object({
  operationType: z.literal("post_square_processing_fee"),
  company: z.literal("High Performance Structures Inc"),
  squarePaymentId: z.string(),
  squareInvoiceId: z.string(),
  squareOrderId: z.string(),
  squareLocationId: z.string(),
  department: z.enum(["HPS", "ORC", "Nu-Tech"]),
  sageInvoiceId: z.string(),
  sageInvoiceNumber: z.string(),
  processingFeeCents: z.number().int().positive(),
  currency: z.literal("USD"),
  depositAccountNumber: z.literal(SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER),
  merchantFeeAccountNumber: z.literal(
    SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER
  ),
  paymentCompletedAt: z.string(),
})

export const sageSquarePaymentPayloadSchema = z.discriminatedUnion(
  "operationType",
  [receiptPayloadSchema, feePayloadSchema]
)

export const sageSquarePaymentResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    operationId: z.string().uuid(),
    claimToken: z.string().uuid(),
    outcome: z.literal("succeeded"),
    sageRecordId: z.string().min(1),
    sageRecordNumber: z.string().min(1),
  }),
  z.object({
    operationId: z.string().uuid(),
    claimToken: z.string().uuid(),
    outcome: z.literal("failed"),
    error: z.string().min(1).max(4000),
  }),
])

export type SquareWebhookEvent = z.infer<typeof squareWebhookEventSchema>
export type SageSquarePaymentPayload = z.infer<
  typeof sageSquarePaymentPayloadSchema
>

export class SageSquarePaymentAttentionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SageSquarePaymentAttentionError"
  }
}

type WebhookBeginResult = "process" | "duplicate"

type BridgeInvoice = {
  readonly id: string
  readonly orderId: string
  readonly locationId: string
  readonly invoiceNumber: string
  readonly sageInvoiceId: string
  readonly department: "HPS" | "ORC" | "Nu-Tech"
}

type OperationContext = {
  readonly squarePaymentId: string
  readonly squareInvoiceId: string
  readonly squareOrderId: string
  readonly squareLocationId: string
  readonly department: "HPS" | "ORC" | "Nu-Tech"
  readonly sageInvoiceId: string
  readonly sageInvoiceNumber: string
  readonly paymentCompletedAt: string
}

function envString(env: object, name: string): string | null {
  const value: unknown = Reflect.get(env, name)
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function sageSquareWritesEnabled(env: object): boolean {
  return (
    envString(env, "SAGE_SQUARE_PAYMENT_WRITES_ENABLED")?.toLowerCase() ===
    "true"
  )
}

function getSquareAccessToken(env: object): string {
  const value = envString(env, "SQUARE_PRODUCTION_ACCESS_TOKEN")
  if (!value) throw new Error("Square production access is not configured")
  return value
}

function squareCutoff(env: object): number {
  const value = envString(env, "SAGE_SQUARE_PAYMENT_CUTOFF_AT")
  const parsed = value ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(parsed)) {
    throw new Error("Sage Square payment cutoff is not configured")
  }
  return parsed
}

async function squareRequest(
  env: object,
  path: string
): Promise<Record<string, unknown>> {
  const response = await fetch(`${SQUARE_API_ORIGIN}${path}`, {
    headers: {
      Authorization: `Bearer ${getSquareAccessToken(env)}`,
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw new Error(`Square lookup failed with status ${response.status}`)
  }
  return z.record(z.string(), z.unknown()).parse(body)
}

async function retrieveOrder(env: object, orderId: string) {
  const body = await squareRequest(
    env,
    `/v2/orders/${encodeURIComponent(orderId)}`
  )
  return orderSchema.parse(Reflect.get(body, "order"))
}

async function retrievePayment(env: object, paymentId: string) {
  const body = await squareRequest(
    env,
    `/v2/payments/${encodeURIComponent(paymentId)}`
  )
  return paymentSchema.parse(Reflect.get(body, "payment"))
}

async function retrieveLocationName(
  env: object,
  locationId: string
): Promise<string> {
  const body = await squareRequest(
    env,
    `/v2/locations/${encodeURIComponent(locationId)}`
  )
  const location = z
    .object({ id: z.string(), name: z.string(), status: z.literal("ACTIVE") })
    .parse(Reflect.get(body, "location"))
  if (location.id !== locationId) {
    throw new Error("Square location lookup returned the wrong location")
  }
  return location.name
}

function sageRecordFromInvoice(
  invoice: z.infer<typeof invoiceSchema>
): string | null {
  const custom = invoice.custom_fields?.filter(
    (field) => field.label.trim().toLowerCase() === "sage record"
  )
  if (!custom || custom.length !== 1) return null
  const value = custom[0]?.value.trim() ?? ""
  if (!/^\d+$/.test(value)) return null
  return invoice.description?.includes(`Source record ${value}.`) ? value : null
}

export function departmentFromSageJob(
  jobName: string
): "HPS" | "ORC" | "Nu-Tech" | null {
  const match = /^\s*([A-Za-z])(?:-|\s|$)/.exec(jobName)
  const prefix = match?.[1]?.toUpperCase()
  if (prefix === "H") return "HPS"
  if (prefix === "O" || prefix === "D") return "ORC"
  if (prefix === "N") return "Nu-Tech"
  return null
}

function bridgeInvoiceFromEvent(
  event: SquareWebhookEvent
): BridgeInvoice | null {
  const object = z.object({ invoice: invoiceSchema }).safeParse(event.data.object)
  if (!object.success) return null
  const invoice = object.data.invoice
  const sageInvoiceId = sageRecordFromInvoice(invoice)
  const sageJob = invoice.custom_fields?.find(
    (field) => field.label.trim().toLowerCase() === "sage job"
  )?.value
  const department = departmentFromSageJob(sageJob ?? invoice.title ?? "")
  if (!sageInvoiceId || !department) return null
  return {
    id: invoice.id,
    orderId: invoice.order_id,
    locationId: invoice.location_id,
    invoiceNumber: invoice.invoice_number,
    sageInvoiceId,
    department,
  }
}

export function squareProcessingFeeExpenseCents(
  fees: readonly z.infer<typeof processingFeeSchema>[]
): number {
  const signedTotal = fees.reduce((total, fee) => {
    if (fee.amount_money.currency !== "USD") {
      throw new SageSquarePaymentAttentionError(
        "Square processing fee currency is not USD"
      )
    }
    return total + fee.amount_money.amount
  }, 0)
  if (signedTotal > 0) {
    throw new SageSquarePaymentAttentionError(
      "Square processing fee adjustments exceed assessed fees"
    )
  }
  // Square reports assessed processing fees as negative deductions. Sage needs
  // the corresponding merchant-service expense as a positive cent amount.
  return signedTotal === 0 ? 0 : -signedTotal
}

function validatePayment(
  payment: z.infer<typeof paymentSchema>,
  invoice: BridgeInvoice,
  order: z.infer<typeof orderSchema>,
  cutoff: number
): void {
  if (payment.status !== "COMPLETED") {
    throw new Error(`Square payment ${payment.id} is not completed`)
  }
  if (payment.order_id !== order.id || payment.location_id !== invoice.locationId) {
    throw new SageSquarePaymentAttentionError(
      "Square payment does not match the bridge invoice order"
    )
  }
  if (Date.parse(payment.created_at) < cutoff) {
    throw new Error("Square payment predates automatic Sage posting")
  }
  if (
    payment.amount_money.currency !== "USD" ||
    payment.total_money.currency !== "USD"
  ) {
    throw new SageSquarePaymentAttentionError(
      "Square payment currency is not USD"
    )
  }
  if (payment.amount_money.amount <= 0) {
    throw new Error("Square payment amount must be positive")
  }
  if ((payment.tip_money?.amount ?? 0) !== 0) {
    throw new SageSquarePaymentAttentionError(
      "Square bridge invoice unexpectedly contains a tip"
    )
  }
  if ((payment.refunded_money?.amount ?? 0) !== 0) {
    throw new SageSquarePaymentAttentionError(
      "Square bridge payment has a refund and needs review"
    )
  }
}

async function insertOperation(
  env: CloudflareEnv,
  operationType: "post_square_receipt" | "post_square_processing_fee",
  idempotencyKey: string,
  context: OperationContext,
  amountCents: number,
  payload: SageSquarePaymentPayload,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sage_square_payment_operations (
       id, operation_type, idempotency_key, square_payment_id,
       square_invoice_id, square_order_id, square_location_id, department,
       sage_invoice_id, sage_invoice_number, amount_cents, currency,
       deposit_account_number, merchant_fee_account_number, payload_json,
       status, payment_completed_at, requested_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, 'queued', ?, ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`
  )
    .bind(
      crypto.randomUUID(),
      operationType,
      idempotencyKey,
      context.squarePaymentId,
      context.squareInvoiceId,
      context.squareOrderId,
      context.squareLocationId,
      context.department,
      context.sageInvoiceId,
      context.sageInvoiceNumber,
      amountCents,
      SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER,
      SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER,
      JSON.stringify(payload),
      context.paymentCompletedAt,
      now,
      now
    )
    .run()
}

async function queueReceipt(
  env: CloudflareEnv,
  payment: z.infer<typeof paymentSchema>,
  invoice: BridgeInvoice,
  now: string
): Promise<OperationContext> {
  const context: OperationContext = {
    squarePaymentId: payment.id,
    squareInvoiceId: invoice.id,
    squareOrderId: invoice.orderId,
    squareLocationId: invoice.locationId,
    department: invoice.department,
    sageInvoiceId: invoice.sageInvoiceId,
    sageInvoiceNumber: invoice.invoiceNumber,
    paymentCompletedAt: payment.updated_at,
  }
  const payload = receiptPayloadSchema.parse({
    operationType: "post_square_receipt",
    company: "High Performance Structures Inc",
    ...context,
    ownerPaymentCents: payment.amount_money.amount,
    clientPaidFeeCents: 0,
    currency: "USD",
    depositAccountNumber: SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER,
    merchantFeeAccountNumber: SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER,
  })
  await insertOperation(
    env,
    "post_square_receipt",
    `square-payment:${payment.id}:receipt:v1`,
    context,
    payment.amount_money.amount,
    payload,
    now
  )
  return context
}

async function queueFeeDelta(
  env: CloudflareEnv,
  context: OperationContext,
  totalFeeCents: number,
  now: string
): Promise<void> {
  if (totalFeeCents <= 0) return
  const existing = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS amount_cents
     FROM sage_square_payment_operations
     WHERE square_payment_id = ?
       AND operation_type = 'post_square_processing_fee'`
  )
    .bind(context.squarePaymentId)
    .first<{ amount_cents: number }>()
  const recorded = existing?.amount_cents ?? 0
  const delta = totalFeeCents - recorded
  if (delta < 0) {
    throw new SageSquarePaymentAttentionError(
      "Square reduced a previously queued processing fee"
    )
  }
  if (delta === 0) return
  const payload = feePayloadSchema.parse({
    operationType: "post_square_processing_fee",
    company: "High Performance Structures Inc",
    ...context,
    processingFeeCents: delta,
    currency: "USD",
    depositAccountNumber: SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER,
    merchantFeeAccountNumber: SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER,
  })
  await insertOperation(
    env,
    "post_square_processing_fee",
    `square-payment:${context.squarePaymentId}:fee-total:${totalFeeCents}`,
    context,
    delta,
    payload,
    now
  )
}

async function processInvoicePayment(
  env: CloudflareEnv,
  event: SquareWebhookEvent,
  cutoff: number,
  now: string
): Promise<void> {
  const invoice = bridgeInvoiceFromEvent(event)
  if (!invoice) return
  const order = await retrieveOrder(env, invoice.orderId)
  if (
    order.location_id !== invoice.locationId ||
    order.reference_id !== `sage-ar-invoice:${invoice.sageInvoiceId}`
  ) {
    throw new SageSquarePaymentAttentionError(
      "Square order is not an exact Sage bridge match"
    )
  }
  const locationName = await retrieveLocationName(env, invoice.locationId)
  if (locationName !== invoice.department) {
    throw new SageSquarePaymentAttentionError(
      "Square location conflicts with the Sage job department"
    )
  }
  const tenders = order.tenders ?? []
  if (tenders.length === 0) {
    throw new Error("Paid Square invoice has no payment tender")
  }
  for (const tender of tenders) {
    const paymentId = tender.payment_id ?? tender.id
    const payment = await retrievePayment(env, paymentId)
    validatePayment(payment, invoice, order, cutoff)
    const context = await queueReceipt(env, payment, invoice, now)
    await queueFeeDelta(
      env,
      context,
      squareProcessingFeeExpenseCents(payment.processing_fee ?? []),
      now
    )
  }
}

function contextFromReceipt(
  operation: typeof sageSquarePaymentOperations.$inferSelect
): OperationContext {
  if (
    operation.department !== "HPS" &&
    operation.department !== "ORC" &&
    operation.department !== "Nu-Tech"
  ) {
    throw new SageSquarePaymentAttentionError(
      "Stored Square payment department is invalid"
    )
  }
  return {
    squarePaymentId: operation.squarePaymentId,
    squareInvoiceId: operation.squareInvoiceId,
    squareOrderId: operation.squareOrderId,
    squareLocationId: operation.squareLocationId,
    department: operation.department,
    sageInvoiceId: operation.sageInvoiceId,
    sageInvoiceNumber: operation.sageInvoiceNumber,
    paymentCompletedAt: operation.paymentCompletedAt,
  }
}

async function processPaymentUpdate(
  env: CloudflareEnv,
  event: SquareWebhookEvent,
  now: string
): Promise<void> {
  const parsed = z.object({ payment: paymentSchema }).safeParse(event.data.object)
  if (!parsed.success) return
  const payment = parsed.data.payment
  const db = getDb(env.DB)
  const receipt = await db
    .select()
    .from(sageSquarePaymentOperations)
    .where(
      and(
        eq(sageSquarePaymentOperations.squarePaymentId, payment.id),
        eq(sageSquarePaymentOperations.operationType, "post_square_receipt")
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!receipt) return
  if (
    payment.status !== "COMPLETED" ||
    (payment.refunded_money?.amount ?? 0) > 0
  ) {
    await env.DB.prepare(
      `UPDATE sage_square_payment_operations
       SET status = CASE WHEN status = 'succeeded' THEN status ELSE 'attention' END,
           error_message = ?, updated_at = ?
       WHERE square_payment_id = ?`
    )
      .bind("Square payment changed or was refunded; review is required", now, payment.id)
      .run()
    throw new SageSquarePaymentAttentionError(
      "Square bridge payment changed or was refunded"
    )
  }
  await queueFeeDelta(
    env,
    contextFromReceipt(receipt),
    squareProcessingFeeExpenseCents(payment.processing_fee ?? []),
    now
  )
}

export async function beginSquareWebhookEvent(
  env: CloudflareEnv,
  event: SquareWebhookEvent,
  now: string
): Promise<WebhookBeginResult> {
  const inserted = await env.DB.prepare(
    `INSERT INTO sage_square_webhook_events (
       event_id, event_type, square_object_id, square_created_at,
       status, attempt_count, received_at, updated_at
     ) VALUES (?, ?, ?, ?, 'processing', 1, ?, ?)
     ON CONFLICT(event_id) DO NOTHING`
  )
    .bind(
      event.event_id,
      event.type,
      event.data.id ?? null,
      event.created_at,
      now,
      now
    )
    .run()
  if (inserted.meta.changes > 0) return "process"
  const staleBefore = new Date(
    Date.parse(now) - SQUARE_WEBHOOK_PROCESSING_LEASE_MS
  ).toISOString()
  const reclaimed = await env.DB.prepare(
    `UPDATE sage_square_webhook_events
     SET status = 'processing', attempt_count = attempt_count + 1,
         error_message = NULL, updated_at = ?
     WHERE event_id = ?
       AND (
         status = 'failed'
         OR (status = 'processing' AND updated_at <= ?)
       )`
  )
    .bind(now, event.event_id, staleBefore)
    .run()
  return reclaimed.meta.changes > 0 ? "process" : "duplicate"
}

export async function completeSquareWebhookEvent(
  env: CloudflareEnv,
  eventId: string,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE sage_square_webhook_events
     SET status = 'processed', error_message = NULL,
         processed_at = ?, updated_at = ?
     WHERE event_id = ?`
  )
    .bind(now, now, eventId)
    .run()
}

export async function failSquareWebhookEvent(
  env: CloudflareEnv,
  eventId: string,
  error: string,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE sage_square_webhook_events
     SET status = 'failed', error_message = ?, updated_at = ?
     WHERE event_id = ?`
  )
    .bind(error.slice(0, 1000), now, eventId)
    .run()
}

export async function flagSquareWebhookEventForAttention(
  env: CloudflareEnv,
  eventId: string,
  error: string,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE sage_square_webhook_events
     SET status = 'attention', error_message = ?,
         processed_at = ?, updated_at = ?
     WHERE event_id = ?`
  )
    .bind(error.slice(0, 1000), now, now, eventId)
    .run()
}

export async function processSquareWebhookEvent(
  env: CloudflareEnv,
  event: SquareWebhookEvent,
  now = new Date().toISOString()
): Promise<void> {
  const cutoff = squareCutoff(env)
  const eventCreatedAt = Date.parse(event.created_at)
  if (!Number.isFinite(eventCreatedAt)) {
    throw new SageSquarePaymentAttentionError(
      "Square webhook event timestamp is invalid"
    )
  }
  if (eventCreatedAt < cutoff) return
  if (event.type === "invoice.payment_made") {
    await processInvoicePayment(env, event, cutoff, now)
    return
  }
  if (event.type === "payment.updated") {
    await processPaymentUpdate(env, event, now)
    return
  }
  if (
    event.type === "invoice.refunded" ||
    event.type === "invoice.scheduled_charge_failed"
  ) {
    const invoice = bridgeInvoiceFromEvent(event)
    if (!invoice) return
    await env.DB.prepare(
      `UPDATE sage_square_payment_operations
       SET status = CASE WHEN status = 'succeeded' THEN status ELSE 'attention' END,
           error_message = ?, updated_at = ?
       WHERE square_invoice_id = ?`
    )
      .bind(`Square reported ${event.type}; review is required`, now, invoice.id)
      .run()
    throw new SageSquarePaymentAttentionError(
      `Square reported ${event.type} for a Sage bridge invoice`
    )
  }
}
