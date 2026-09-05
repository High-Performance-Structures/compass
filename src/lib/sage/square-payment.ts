import { and, eq, isNull, lt, or, sql } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { sageSquarePaymentOperations } from "@/db/schema-sage"
import { notifySageSquareManualReceipt } from "@/lib/sage/square-payment-notifications"

export const SQUARE_API_VERSION = "2026-08-19"
export const SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER = 10000
export const SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER = 62020

type SageSquareOperationType =
  | "post_square_receipt"
  | "post_square_processing_fee"
type SageSquareOperationStatus = "queued" | "manual_action_required"

const SQUARE_API_ORIGIN = "https://connect.squareup.com"
const SQUARE_WEBHOOK_PROCESSING_LEASE_MS = 10 * 60 * 1000
const SQUARE_PAYMENT_OPERATION_CLAIM_LEASE_MS = 10 * 60 * 1000
const MANUAL_RECEIPT_RECONCILIATION_BATCH = 100
const LEGACY_SCOPE_HYDRATION_BATCH = 100

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
  readonly organizationId: string | null
  readonly projectId: string | null
  readonly receiptOperationId: string | null

  constructor(
    message: string,
    scope?: CompassNotificationScope
  ) {
    super(message)
    this.name = "SageSquarePaymentAttentionError"
    this.organizationId = scope?.organizationId ?? null
    this.projectId = scope?.projectId ?? null
    this.receiptOperationId = scope?.receiptOperationId ?? null
  }
}

type WebhookBeginResult = "process" | "duplicate"

type BridgeInvoice = {
  readonly id: string
  readonly orderId: string
  readonly locationId: string
  readonly invoiceNumber: string
  readonly sageInvoiceId: string
  readonly sageJobShortName: string
  readonly department: "HPS" | "ORC" | "Nu-Tech"
}

type ActiveCompassProject = {
  readonly id: string
  readonly organizationId: string
}

type CompassNotificationScope = {
  readonly organizationId: string
  readonly projectId: string | null
  readonly receiptOperationId?: string
}

type OperationContext = {
  readonly squarePaymentId: string
  readonly squareInvoiceId: string
  readonly squareOrderId: string
  readonly squareLocationId: string
  readonly department: "HPS" | "ORC" | "Nu-Tech"
  readonly sageInvoiceId: string
  readonly sageInvoiceNumber: string
  readonly organizationId: string
  readonly projectId: string
  readonly sageJobShortName: string
  readonly paymentCompletedAt: string
}

function envString(env: object, name: string): string | null {
  const value: unknown = Reflect.get(env, name)
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function sageSquareOrganizationId(env: object): string | null {
  return envString(env, "SAGE_SQUARE_ORGANIZATION_ID")
}

export function sageSquareWritesEnabled(env: object): boolean {
  return (
    envString(env, "SAGE_SQUARE_PAYMENT_WRITES_ENABLED")?.toLowerCase() ===
    "true"
  )
}

export function sageSquareInitialOperationStatus(
  operationType: SageSquareOperationType
): SageSquareOperationStatus {
  return operationType === "post_square_receipt"
    ? "manual_action_required"
    : "queued"
}

export function isSageSquareWriterOperation(operationType: string): boolean {
  return operationType === "post_square_processing_fee"
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

async function retrieveInvoice(env: object, invoiceId: string) {
  const body = await squareRequest(
    env,
    `/v2/invoices/${encodeURIComponent(invoiceId)}`
  )
  return invoiceSchema.parse(Reflect.get(body, "invoice"))
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

function bridgeInvoiceFromSquareInvoice(
  invoice: z.infer<typeof invoiceSchema>
): BridgeInvoice | null {
  const sageInvoiceId = sageRecordFromInvoice(invoice)
  const sageJobShortName = invoice.custom_fields?.find(
    (field) => field.label.trim().toLowerCase() === "sage job"
  )?.value.trim()
  const department = departmentFromSageJob(
    sageJobShortName ?? invoice.title ?? ""
  )
  if (!sageInvoiceId || !department || !sageJobShortName) return null
  return {
    id: invoice.id,
    orderId: invoice.order_id,
    locationId: invoice.location_id,
    invoiceNumber: invoice.invoice_number,
    sageInvoiceId,
    sageJobShortName,
    department,
  }
}

function bridgeInvoiceFromEvent(
  event: SquareWebhookEvent
): BridgeInvoice | null {
  const object = z.object({ invoice: invoiceSchema }).safeParse(event.data.object)
  return object.success
    ? bridgeInvoiceFromSquareInvoice(object.data.invoice)
    : null
}

async function resolveActiveCompassProject(
  env: CloudflareEnv,
  sageJobShortName: string
): Promise<ActiveCompassProject> {
  const organizationId = sageSquareOrganizationId(env)
  if (!organizationId) {
    throw new SageSquarePaymentAttentionError(
      "Sage Square organization scope is not configured"
    )
  }
  const db = getDb(env.DB)
  const matches = await db
    .select({
      id: projects.id,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        sql`upper(trim(${projects.projectNumber})) = upper(trim(${sageJobShortName}))`,
        eq(projects.status, "OPEN")
      )
    )
    .limit(2)
  if (matches.length !== 1 || matches[0]?.organizationId !== organizationId) {
    throw new SageSquarePaymentAttentionError(
      `Sage job ${sageJobShortName} does not map to exactly one active Compass project`,
      { organizationId, projectId: null }
    )
  }
  return { id: matches[0].id, organizationId: matches[0].organizationId }
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
  operationType: SageSquareOperationType,
  idempotencyKey: string,
  context: OperationContext,
  amountCents: number,
  payload: SageSquarePaymentPayload,
  now: string
): Promise<string> {
  const operationId = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO sage_square_payment_operations (
       id, organization_id, project_id, operation_type, idempotency_key, square_payment_id,
       square_invoice_id, square_order_id, square_location_id, department,
       sage_job_short_name, sage_invoice_id, sage_invoice_number, amount_cents, currency,
       deposit_account_number, merchant_fee_account_number, payload_json,
       status, payment_completed_at, requested_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET
       organization_id = excluded.organization_id,
       project_id = excluded.project_id,
       sage_job_short_name = excluded.sage_job_short_name,
       updated_at = excluded.updated_at`
  )
    .bind(
      operationId,
      context.organizationId,
      context.projectId,
      operationType,
      idempotencyKey,
      context.squarePaymentId,
      context.squareInvoiceId,
      context.squareOrderId,
      context.squareLocationId,
      context.department,
      context.sageJobShortName,
      context.sageInvoiceId,
      context.sageInvoiceNumber,
      amountCents,
      SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER,
      SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER,
      JSON.stringify(payload),
      sageSquareInitialOperationStatus(operationType),
      context.paymentCompletedAt,
      now,
      now
    )
    .run()
  const stored = await env.DB.prepare(
    `SELECT id FROM sage_square_payment_operations WHERE idempotency_key = ?`
  )
    .bind(idempotencyKey)
    .first<{ id: string }>()
  if (!stored) throw new Error("Square payment operation was not stored")
  return stored.id
}

async function queueReceipt(
  env: CloudflareEnv,
  payment: z.infer<typeof paymentSchema>,
  invoice: BridgeInvoice,
  project: ActiveCompassProject,
  now: string
): Promise<{ readonly context: OperationContext; readonly operationId: string }> {
  const context: OperationContext = {
    squarePaymentId: payment.id,
    squareInvoiceId: invoice.id,
    squareOrderId: invoice.orderId,
    squareLocationId: invoice.locationId,
    department: invoice.department,
    sageInvoiceId: invoice.sageInvoiceId,
    sageInvoiceNumber: invoice.invoiceNumber,
    organizationId: project.organizationId,
    projectId: project.id,
    sageJobShortName: invoice.sageJobShortName,
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
  const operationId = await insertOperation(
    env,
    "post_square_receipt",
    `square-payment:${payment.id}:receipt:v1`,
    context,
    payment.amount_money.amount,
    payload,
    now
  )
  return { context, operationId }
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
  const project = await resolveActiveCompassProject(env, invoice.sageJobShortName)
  const scope = {
    organizationId: project.organizationId,
    projectId: project.id,
  }
  try {
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
      const receipt = await queueReceipt(env, payment, invoice, project, now)
      await notifySageSquareManualReceipt(env, {
        organizationId: project.organizationId,
        projectId: project.id,
        operationId: receipt.operationId,
        squarePaymentId: payment.id,
        sageInvoiceNumber: invoice.invoiceNumber,
        department: invoice.department,
        ownerPaymentCents: payment.amount_money.amount,
        depositAccountNumber: SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER,
        merchantFeeAccountNumber: SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER,
      })
      try {
        await queueFeeDelta(
          env,
          receipt.context,
          squareProcessingFeeExpenseCents(payment.processing_fee ?? []),
          now
        )
      } catch (error) {
        if (error instanceof SageSquarePaymentAttentionError) {
          throw new SageSquarePaymentAttentionError(error.message, {
            ...scope,
            receiptOperationId: receipt.operationId,
          })
        }
        throw error
      }
    }
  } catch (error) {
    if (error instanceof SageSquarePaymentAttentionError) {
      throw new SageSquarePaymentAttentionError(
        error.message,
        error.receiptOperationId
          ? { ...scope, receiptOperationId: error.receiptOperationId }
          : scope
      )
    }
    throw error
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
  if (
    !operation.organizationId ||
    !operation.projectId ||
    !operation.sageJobShortName
  ) {
    throw new SageSquarePaymentAttentionError(
      "Stored Square payment is not linked to a Compass project"
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
    organizationId: operation.organizationId,
    projectId: operation.projectId,
    sageJobShortName: operation.sageJobShortName,
    paymentCompletedAt: operation.paymentCompletedAt,
  }
}

async function contextFromReceiptWithLegacyHydration(
  env: CloudflareEnv,
  operation: typeof sageSquarePaymentOperations.$inferSelect
): Promise<OperationContext> {
  if (
    operation.organizationId &&
    operation.projectId &&
    operation.sageJobShortName
  ) {
    return contextFromReceipt(operation)
  }
  const squareInvoice = await retrieveInvoice(env, operation.squareInvoiceId)
  const invoice = bridgeInvoiceFromSquareInvoice(squareInvoice)
  if (
    !invoice ||
    invoice.id !== operation.squareInvoiceId ||
    invoice.orderId !== operation.squareOrderId ||
    invoice.locationId !== operation.squareLocationId ||
    invoice.sageInvoiceId !== operation.sageInvoiceId
  ) {
    throw new SageSquarePaymentAttentionError(
      "Legacy Square receipt could not be linked to its bridge invoice"
    )
  }
  const project = await resolveActiveCompassProject(env, invoice.sageJobShortName)
  const db = getDb(env.DB)
  await db
    .update(sageSquarePaymentOperations)
    .set({
      organizationId: project.organizationId,
      projectId: project.id,
      sageJobShortName: invoice.sageJobShortName,
      updatedAt: new Date().toISOString(),
    })
    .where(
      eq(
        sageSquarePaymentOperations.squarePaymentId,
        operation.squarePaymentId
      )
    )
  return contextFromReceipt({
    ...operation,
    organizationId: project.organizationId,
    projectId: project.id,
    sageJobShortName: invoice.sageJobShortName,
  })
}

export async function hydrateLegacySageSquarePaymentScopes(
  env: CloudflareEnv,
  squarePaymentId?: string
): Promise<void> {
  const db = getDb(env.DB)
  const receipts = await db
    .select()
    .from(sageSquarePaymentOperations)
    .where(
      and(
        eq(sageSquarePaymentOperations.operationType, "post_square_receipt"),
        or(
          isNull(sageSquarePaymentOperations.organizationId),
          isNull(sageSquarePaymentOperations.projectId),
          isNull(sageSquarePaymentOperations.sageJobShortName)
        ),
        squarePaymentId
          ? eq(sageSquarePaymentOperations.squarePaymentId, squarePaymentId)
          : undefined
      )
    )
    .limit(LEGACY_SCOPE_HYDRATION_BATCH)
  for (const receipt of receipts) {
    try {
      await contextFromReceiptWithLegacyHydration(env, receipt)
    } catch (error) {
      console.error(
        `Unable to hydrate legacy Square receipt ${receipt.id}`,
        error
      )
    }
  }
}

export type SageSquareManualReceiptReconciliationResult = {
  readonly scanned: number
  readonly transitioned: number
}

export async function reconcileSageSquareManualReceipts(
  env: CloudflareEnv,
  now = new Date()
): Promise<SageSquareManualReceiptReconciliationResult> {
  const db = getDb(env.DB)
  const staleClaimIso = new Date(
    now.getTime() - SQUARE_PAYMENT_OPERATION_CLAIM_LEASE_MS
  ).toISOString()
  const receipts = await db
    .select()
    .from(sageSquarePaymentOperations)
    .where(
      and(
        eq(sageSquarePaymentOperations.operationType, "post_square_receipt"),
        or(
          eq(sageSquarePaymentOperations.status, "queued"),
          and(
            eq(sageSquarePaymentOperations.status, "running"),
            lt(sageSquarePaymentOperations.claimedAt, staleClaimIso)
          )
        )
      )
    )
    .limit(MANUAL_RECEIPT_RECONCILIATION_BATCH)
  let transitioned = 0
  for (const receipt of receipts) {
    const context = await contextFromReceiptWithLegacyHydration(env, receipt)
    // Notify first so a transient delivery failure leaves the row queued for
    // the next maintenance pass. Notification creation is itself deduplicated.
    await notifySageSquareManualReceipt(env, {
      organizationId: context.organizationId,
      projectId: context.projectId,
      operationId: receipt.id,
      squarePaymentId: context.squarePaymentId,
      sageInvoiceNumber: context.sageInvoiceNumber,
      department: context.department,
      ownerPaymentCents: receipt.amountCents,
      depositAccountNumber: receipt.depositAccountNumber,
      merchantFeeAccountNumber: receipt.merchantFeeAccountNumber,
    })
    const updated = await db
      .update(sageSquarePaymentOperations)
      .set({
        status: "manual_action_required",
        claimToken: null,
        claimedAt: null,
        updatedAt: now.toISOString(),
      })
      .where(
        and(
          eq(sageSquarePaymentOperations.id, receipt.id),
          or(
            eq(sageSquarePaymentOperations.status, "queued"),
            and(
              eq(sageSquarePaymentOperations.status, "running"),
              lt(sageSquarePaymentOperations.claimedAt, staleClaimIso)
            )
          )
        )
      )
      .returning({ id: sageSquarePaymentOperations.id })
    if (updated.length === 1) transitioned += 1
  }
  return { scanned: receipts.length, transitioned }
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
  const context = await contextFromReceiptWithLegacyHydration(env, receipt)
  const scope = {
    organizationId: context.organizationId,
    projectId: context.projectId,
    receiptOperationId: receipt.id,
  }
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
      "Square bridge payment changed or was refunded",
      scope
    )
  }
  try {
    await queueFeeDelta(
      env,
      context,
      squareProcessingFeeExpenseCents(payment.processing_fee ?? []),
      now
    )
  } catch (error) {
    if (error instanceof SageSquarePaymentAttentionError) {
      throw new SageSquarePaymentAttentionError(error.message, scope)
    }
    throw error
  }
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
    const db = getDb(env.DB)
    const receipt = await db
      .select({
        id: sageSquarePaymentOperations.id,
        organizationId: sageSquarePaymentOperations.organizationId,
        projectId: sageSquarePaymentOperations.projectId,
      })
      .from(sageSquarePaymentOperations)
      .where(
        and(
          eq(sageSquarePaymentOperations.squareInvoiceId, invoice.id),
          eq(
            sageSquarePaymentOperations.operationType,
            "post_square_receipt"
          )
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const scope: CompassNotificationScope | undefined =
      receipt?.organizationId && receipt.projectId
        ? {
            organizationId: receipt.organizationId,
            projectId: receipt.projectId,
            receiptOperationId: receipt.id,
          }
        : undefined
    await env.DB.prepare(
      `UPDATE sage_square_payment_operations
       SET status = CASE WHEN status = 'succeeded' THEN status ELSE 'attention' END,
           error_message = ?, updated_at = ?
       WHERE square_invoice_id = ?`
    )
      .bind(`Square reported ${event.type}; review is required`, now, invoice.id)
      .run()
    throw new SageSquarePaymentAttentionError(
      `Square reported ${event.type} for a Sage bridge invoice`,
      scope
    )
  }
}
