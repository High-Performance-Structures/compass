import { and, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  notificationEvents,
  users,
} from "@/db/schema"
import { settleNotificationRecipientsWhereStatement } from "@/lib/domain/notifications/store"
import { createSystemNotificationEvent } from "@/lib/notifications/events"
import { squareAlertRecipientIds } from "@/lib/sage/square-alert-recipients"

const EXCEPTION_EVENT_TYPE = "sage.square_payment.exception"
const MANUAL_RECEIPT_EVENT_TYPE = "sage.square_payment.manual_receipt"
const EXCEPTION_SOURCE_TYPE = "sage_square_payment"

type SageSquareAdminNotificationInput = {
  readonly organizationId: string
  readonly projectId: string | null
  readonly receiptOperationId: string | null
  readonly eventType: string
  readonly sourceId: string
  readonly title: string
  readonly body: string
  readonly priority: "normal" | "high"
}

export type SageSquareManualReceiptNotificationInput = {
  readonly organizationId: string
  readonly projectId: string
  readonly operationId: string
  readonly squarePaymentId: string
  readonly sageInvoiceNumber: string
  readonly department: "HPS" | "ORC" | "Nu-Tech"
  readonly ownerPaymentCents: number
  readonly depositAccountNumber: number
  readonly merchantFeeAccountNumber: number
}

function usdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

export function manualReceiptNotificationBody(
  input: SageSquareManualReceiptNotificationInput
): string {
  return [
    `Square received ${usdFromCents(input.ownerPaymentCents)} for Sage invoice ${input.sageInvoiceNumber} (${input.department}).`,
    `In Sage 3-3-2 Electronic Receipts, use Post—not Process and Post—apply the full amount to this invoice, and use account ${input.depositAccountNumber} — FSB Project Checking.`,
    `Compass is retaining the Square fee reconciliation for account ${input.merchantFeeAccountNumber} — Merchant Service Fees. This is a posting step, not a second payment approval.`,
  ].join(" ")
}

async function notifySageSquareAdmins(
  env: CloudflareEnv,
  input: SageSquareAdminNotificationInput
): Promise<void> {
  const db = getDb(env.DB)
  const existing = await db
    .select({ id: notificationEvents.id })
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.eventType, input.eventType),
        eq(notificationEvents.sourceType, EXCEPTION_SOURCE_TYPE),
        eq(notificationEvents.sourceId, input.sourceId),
        eq(notificationEvents.organizationId, input.organizationId)
      )
    )
  if (existing.length > 0) return
  // Chosen in Settings → Workflows → Square and Sage payments; administrators otherwise.
  const recipientIds = await squareAlertRecipientIds(db, env, input.organizationId, "payments")
  const admins = await db
    .select({
      userId: users.id,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, recipientIds.length > 0 ? [...recipientIds] : [""]))
  await createSystemNotificationEvent({
    organizationId: input.organizationId,
    projectId: input.projectId,
    eventType: input.eventType,
    sourceType: EXCEPTION_SOURCE_TYPE,
    sourceId: input.sourceId,
    title: input.title,
    body: input.body,
    href: input.projectId && input.receiptOperationId
      ? `/dashboard/projects/${encodeURIComponent(input.projectId)}/financials?squareReceipt=${encodeURIComponent(input.receiptOperationId)}`
      : input.projectId
        ? `/dashboard/projects/${encodeURIComponent(input.projectId)}/financials`
      : "/dashboard/financials?tab=payments",
    priority: input.priority,
    audience: "internal",
    recipients: admins,
    delivery: { inApp: true, email: false, push: false },
  })
}

export async function notifySageSquareException(
  env: CloudflareEnv,
  scope: {
    readonly organizationId: string
    readonly projectId: string | null
    readonly receiptOperationId?: string
  },
  sourceId: string,
  title: string,
  body: string
): Promise<void> {
  await notifySageSquareAdmins(env, {
    ...scope,
    receiptOperationId: scope.receiptOperationId ?? null,
    eventType: EXCEPTION_EVENT_TYPE,
    sourceId,
    title,
    body,
    priority: "high",
  })
}

export async function dismissSageSquareException(
  env: CloudflareEnv,
  sourceId: string,
  now: string
): Promise<void> {
  await settleNotificationRecipientsWhereStatement(env.DB, {
    markRead: true,
    now,
    where: {
      sql: `event_id IN (
       SELECT id
       FROM notification_events
       WHERE event_type = ? AND source_type = ? AND source_id = ?
     )`,
      binds: [EXCEPTION_EVENT_TYPE, EXCEPTION_SOURCE_TYPE, sourceId],
    },
  }).run()
}

export async function notifySageSquareManualReceipt(
  env: CloudflareEnv,
  input: SageSquareManualReceiptNotificationInput
): Promise<void> {
  await notifySageSquareAdmins(env, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    receiptOperationId: input.operationId,
    eventType: MANUAL_RECEIPT_EVENT_TYPE,
    sourceId: input.operationId,
    title: `Post Square payment for Sage invoice ${input.sageInvoiceNumber}`,
    body: manualReceiptNotificationBody(input),
    priority: "high",
  })
}
