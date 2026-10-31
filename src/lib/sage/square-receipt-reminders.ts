import { z } from "zod/v4"

import { getDb } from "@/db"
import { formatCents } from "@/lib/format"
import {
  insertInternalNotificationEventWhereStatement,
  insertNotificationRecipientWhereStatement,
  settleNotificationRecipientsWhereStatement,
} from "@/lib/domain/notifications/store"
import {
  markSageReceiptAlreadyInSageStatement,
  recordSageReceiptCheckedStatement,
  recordSageReceiptReminderStatement,
} from "@/lib/domain/sage-bridge/square-store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { squareAlertRecipientIds } from "@/lib/sage/square-alert-recipients"
import { authorizedFinanceStaff, type SquareCreatorConfiguration } from "@/lib/sage/square-creator-alerts"

/** A read-only check of Sage for the receipt staff enter by hand. */
export const sageReceiptObservationSchema = z.object({
  kind: z.literal("receipt"),
  operationId: z.string().uuid(),
  sageInvoiceId: z.string().regex(/^[1-9]\d{0,14}$/),
  entered: z.boolean(),
  sageRecordId: z.string().trim().min(1).max(100).nullable(),
  sageRecordNumber: z.string().trim().min(1).max(100).nullable(),
  matchReason: z.string().trim().min(1).max(500).nullable(),
  checkedAt: z.iso.datetime(),
}).strict()

type ReceiptObservation = z.infer<typeof sageReceiptObservationSchema>
type OpenReceipt = {
  readonly id: string
  readonly project_id: string | null
  readonly sage_invoice_id: string
  readonly sage_invoice_number: string
  readonly sage_invoice_creator_username: string | null
  readonly amount_cents: number
  readonly payment_completed_at: string
  readonly receipt_reminded_at: string | null
  readonly receipt_reminder_count: number
}

// Receipts waiting for someone to enter them in Sage.
const AWAITING_ENTRY = `operation_type = 'post_square_receipt' AND status = 'manual_action_required'`
const RECHECK_AFTER_MS = 10 * 60 * 1000
const REMINDER_PREFIX = "square-receipt-reminder"

/** Receipts to look for in Sage, at most every ten minutes each. */
export async function pendingSageReceiptChecks(env: CloudflareEnv, organizationId: string): Promise<readonly {
  readonly operationId: string
  readonly sageInvoiceId: string
  readonly invoiceNumber: string
  readonly amountCents: number
  readonly paymentCompletedAt: string
}[]> {
  const before = new Date(Date.now() - RECHECK_AFTER_MS).toISOString()
  const rows = await env.DB.prepare(`SELECT * FROM sage_square_payment_operations
    WHERE organization_id = ? AND ${AWAITING_ENTRY}
      AND (sage_receipt_checked_at IS NULL OR sage_receipt_checked_at < ?)
    ORDER BY payment_completed_at LIMIT 20`).bind(organizationId, before).all<OpenReceipt>()
  return rows.results.map(row => ({ operationId: row.id, sageInvoiceId: row.sage_invoice_id,
    invoiceNumber: row.sage_invoice_number, amountCents: row.amount_cents, paymentCompletedAt: row.payment_completed_at }))
}

/**
 * Records what Sage showed. A receipt found in Sage is marked "Already in
 * Sage" and its posting reminders are cleared from everyone's bell.
 */
export async function recordSageReceiptCheck(env: CloudflareEnv, organizationId: string, observation: ReceiptObservation): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT * FROM sage_square_payment_operations
    WHERE id = ? AND organization_id = ? AND operation_type = 'post_square_receipt'`)
    .bind(observation.operationId, organizationId).first<OpenReceipt>()
  if (!row || row.sage_invoice_id !== observation.sageInvoiceId) return false
  const now = new Date().toISOString()
  if (!observation.entered) {
    await recordSageReceiptCheckedStatement(env.DB, {
      operationId: row.id, organizationId, checkedAt: observation.checkedAt,
    }).run()
    return true
  }
  await env.DB.batch([
    markSageReceiptAlreadyInSageStatement(env.DB, {
      operationId: row.id, organizationId, sageRecordId: observation.sageRecordId,
      sageRecordNumber: observation.sageRecordNumber, checkedAt: observation.checkedAt,
      awaitingEntry: AWAITING_ENTRY, now,
    }),
    // Clear the original "post this payment" alert and every reminder for it.
    settleNotificationRecipientsWhereStatement(env.DB, { markRead: true, now, where: {
      sql: `event_id IN (SELECT id FROM notification_events WHERE organization_id = ? AND source_type = 'sage_square_payment'
        AND source_id = ? AND event_type IN ('sage.square_payment.manual_receipt', 'sage.square_payment.receipt_reminder'))`,
      binds: [organizationId, row.id],
    } }),
  ])
  return true
}

/** Whether `now` is a weekday between 7 AM and 5 PM in the company's time zone. */
export function withinBusinessHours(now: Date, timeZone: string): boolean {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now)
  } catch {
    return true
  }
  const weekday = parts.find(part => part.type === "weekday")?.value ?? ""
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "12")
  return !["Sat", "Sun"].includes(weekday) && hour >= 7 && hour < 17
}


/**
 * Reminds the person who created the Sage invoice, plus the people chosen in
 * Settings, every few hours until the Square receipt is entered in Sage.
 */
export async function sendSquareReceiptReminders(env: CloudflareEnv, config: SquareCreatorConfiguration, now = new Date()): Promise<number> {
  const db = getDb(env.DB)
  const settings = await readFeatureSettings(db, config.organizationId, "square-payments")
  if (settings.receiptReminderHours === 0) return 0
  if (settings.receiptReminderBusinessHoursOnly && !withinBusinessHours(now, settings.timeZone)) return 0
  const due = new Date(now.getTime() - settings.receiptReminderHours * 60 * 60 * 1000).toISOString()
  const rows = await env.DB.prepare(`SELECT * FROM sage_square_payment_operations
    WHERE organization_id = ? AND ${AWAITING_ENTRY} AND payment_completed_at <= ?
      AND (receipt_reminded_at IS NULL OR receipt_reminded_at <= ?)
    ORDER BY payment_completed_at LIMIT 25`).bind(config.organizationId, due, due).all<OpenReceipt>()
  if (rows.results.length === 0) return 0

  const staff = await authorizedFinanceStaff(env, config.organizationId)
  const staffIds = new Set(staff.map(member => member.id))
  const alwaysIds = settings.receiptReminderUserIds.length > 0
    ? settings.receiptReminderUserIds
    : await squareAlertRecipientIds(db, env, config.organizationId, "payments")
  const always = alwaysIds.filter(id => staffIds.has(id))
  const stamp = now.toISOString()
  let sent = 0
  for (const row of rows.results) {
    const creatorId = row.sage_invoice_creator_username === null ? undefined : config.mappings.get(row.sage_invoice_creator_username)
    const recipients = [...new Set([...(creatorId && staffIds.has(creatorId) ? [creatorId] : []), ...always])]
    if (recipients.length === 0) continue
    const count = row.receipt_reminder_count + 1
    const eventId = `${REMINDER_PREFIX}:${config.organizationId}:${row.id}:${count}`
    const days = Math.max(1, Math.floor((now.getTime() - Date.parse(row.payment_completed_at)) / 86_400_000))
    const title = `Reminder: enter the Square payment for ${row.sage_invoice_number} in Sage`
    const body = `Square received ${formatCents(row.amount_cents)} for Sage invoice ${row.sage_invoice_number} ${days} day${days === 1 ? "" : "s"} ago, and the receipt isn't in Sage yet. Enter it in Sage 3-3-2 Electronic Receipts (Post, not Process and Post). Compass checks Sage and stops reminding once it's there.`
    const href = row.project_id
      ? `/dashboard/projects/${encodeURIComponent(row.project_id)}/financials?squareReceipt=${encodeURIComponent(row.id)}`
      : "/dashboard/financials?tab=payments"
    const stillOpen = `EXISTS (SELECT 1 FROM sage_square_payment_operations WHERE id = ? AND ${AWAITING_ENTRY} AND receipt_reminder_count = ?)`
    const eventStored = { sql: "EXISTS (SELECT 1 FROM notification_events WHERE id = ?)", binds: [eventId] }
    const statements = [
      insertInternalNotificationEventWhereStatement(env.DB, {
        id: eventId, organizationId: config.organizationId, projectId: row.project_id,
        eventType: "sage.square_payment.receipt_reminder", sourceType: "sage_square_payment", sourceId: row.id,
        title, body, href, priority: "high", createdAt: stamp,
      }, { sql: stillOpen, binds: [row.id, row.receipt_reminder_count] }),
      ...recipients.map(userId => insertNotificationRecipientWhereStatement(env.DB, {
        id: `${eventId}:${userId}`, eventId, userId, createdAt: stamp,
      }, eventStored)),
      // Only the newest reminder stays in the bell.
      settleNotificationRecipientsWhereStatement(env.DB, { markRead: false, now: stamp, where: {
        sql: `event_id IN (SELECT id FROM notification_events WHERE organization_id = ? AND source_type = 'sage_square_payment'
          AND source_id = ? AND event_type = 'sage.square_payment.receipt_reminder' AND id <> ?)
          AND EXISTS (SELECT 1 FROM notification_events WHERE id = ?)`,
        binds: [config.organizationId, row.id, eventId, eventId],
      } }),
      recordSageReceiptReminderStatement(env.DB, {
        operationId: row.id, organizationId: config.organizationId,
        previousCount: row.receipt_reminder_count, eventId, now: stamp,
      }),
    ]
    const results = await env.DB.batch(statements)
    if (results[results.length - 1]?.meta.changes === 1) sent += 1
  }
  return sent
}
