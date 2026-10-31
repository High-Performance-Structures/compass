import { z } from "zod/v4"

import { getDb } from "@/db"
import { insertInternalNotificationEventWhereStatement, insertNotificationRecipientWhereStatement, settleNotificationRecipientsWhereStatement } from "@/lib/domain/notifications/store"
import { markSageSquareCreatorNotifiedStatement, recordSageSquareInvoiceCreatorStatement } from "@/lib/domain/sage-bridge/square-store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { getJarvisEnvValue } from "@/lib/jarvis/auth"
import { getPermissions } from "@/lib/permissions"
import { squareAlertRecipientIds } from "@/lib/sage/square-alert-recipients"
import { isInternalStaffRole } from "@/lib/user-roles"

const mappingSchema = z.array(z.object({
  sageUsername: z.string().trim().min(1).max(100),
  userId: z.string().trim().min(1).max(100),
}).strict()).max(100)

export const invoiceCreatorObservationSchema = z.object({
  operationId: z.string().uuid(),
  sageInvoiceId: z.string().regex(/^[1-9]\d{0,14}$/),
  invoiceNumber: z.string().trim().min(1).max(100),
  sageJobShortName: z.string().trim().min(1).max(100),
  creatorUsername: z.string().trim().min(1).max(100).nullable(),
  checkedAt: z.iso.datetime(),
}).strict()

type Observation = z.infer<typeof invoiceCreatorObservationSchema>
export type SquareCreatorConfiguration = {
  readonly organizationId: string
  readonly from: string
  /** Sage username (lower case) → Compass user ID. */
  readonly mappings: ReadonlyMap<string, string>
}
type Receipt = {
  readonly id: string
  readonly project_id: string
  readonly sage_invoice_id: string
  readonly sage_invoice_number: string
  readonly sage_job_short_name: string
  readonly amount_cents: number
  readonly sage_invoice_creator_username: string | null
  readonly invoice_creator_lookup_at: string | null
  readonly status: string
}

// Payment-received alerts only look back this far when no explicit cutoff is
// configured, so turning the feature on doesn't replay old payments.
const DEFAULT_ALERT_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000
const OPEN_STATUSES = "('queued', 'running', 'manual_action_required', 'succeeded', 'already_in_sage')"

function envMappings(env: CloudflareEnv): readonly { readonly sageUsername: string; readonly userId: string }[] {
  const raw = getJarvisEnvValue(env, "SAGE_INVOICE_CREATOR_USER_MAP")
  if (!raw) return []
  try {
    const parsed = mappingSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

/**
 * Sage invoice creators are matched to Compass people by exact Sage login,
 * set in Settings → Workflows → Square and Sage payments (the older
 * SAGE_INVOICE_CREATOR_USER_MAP secret is the fallback). Never guessed from
 * names or emails.
 */
export async function squareCreatorAlertConfiguration(env: CloudflareEnv): Promise<SquareCreatorConfiguration | null> {
  const organizationId = getJarvisEnvValue(env, "SAGE_SQUARE_ORGANIZATION_ID")
  if (!organizationId) return null
  const settings = await readFeatureSettings(getDb(env.DB), organizationId, "square-payments")
  const rows = settings.sageUserMappings.length > 0 ? settings.sageUserMappings : envMappings(env)
  const mappings = new Map<string, string>()
  for (const row of rows) {
    const username = row.sageUsername.trim().toLowerCase()
    if (!mappings.has(username)) mappings.set(username, row.userId)
  }
  const configuredFrom = getJarvisEnvValue(env, "SAGE_SQUARE_CREATOR_ALERTS_FROM")
  const from = configuredFrom && z.iso.datetime().safeParse(configuredFrom).success
    ? new Date(configuredFrom).toISOString()
    : new Date(Date.now() - DEFAULT_ALERT_LOOKBACK_MS).toISOString()
  return { organizationId, from, mappings }
}

// Payment-received alerts require the exact imported invoice, payment,
// allocation, and project scope. A queued receipt alone is not proof that the
// financial import completed.
const ELIGIBLE = `FROM sage_square_payment_operations r
  JOIN projects p ON p.id = r.project_id AND p.organization_id = r.organization_id
    AND upper(trim(p.project_number)) = upper(trim(r.sage_job_short_name))
  JOIN invoices i ON i.organization_id = r.organization_id AND i.project_id = r.project_id
    AND i.source_system = 'sage' AND i.source_external_id = 'sage-ar-invoice:' || r.sage_invoice_id
    AND i.invoice_number = r.sage_invoice_number
  JOIN payments pay ON pay.organization_id = r.organization_id AND pay.project_id = r.project_id
    AND pay.source_system = 'sage' AND pay.source_external_id = 'square-payment:' || r.square_payment_id
  WHERE r.organization_id = ? AND r.operation_type = 'post_square_receipt'
    AND r.status IN ${OPEN_STATUSES}
    AND r.error_message IS NULL
    AND r.currency = 'USD' AND r.amount_cents > 0 AND r.payment_completed_at >= ?
    AND EXISTS (SELECT 1 FROM invoice_payment_allocations a WHERE a.payment_id = pay.id AND a.invoice_id = i.id
      AND a.organization_id = r.organization_id AND a.project_id = r.project_id)`

/** Receipts whose original Sage invoice creator hasn't been read yet (reread hourly when Sage had none). */
export async function pendingSquareInvoiceCreators(env: CloudflareEnv, config: SquareCreatorConfiguration): Promise<readonly {
  readonly operationId: string
  readonly sageInvoiceId: string
  readonly invoiceNumber: string
  readonly sageJobShortName: string
}[]> {
  const retryBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const rows = await env.DB.prepare(`SELECT r.* FROM sage_square_payment_operations r
    WHERE r.organization_id = ? AND r.operation_type = 'post_square_receipt'
    AND r.status IN ${OPEN_STATUSES} AND r.error_message IS NULL AND r.sage_job_short_name IS NOT NULL
    AND r.sage_invoice_creator_username IS NULL
    AND (r.invoice_creator_lookup_at IS NULL OR r.invoice_creator_lookup_at < ?)
    ORDER BY r.payment_completed_at LIMIT 10`).bind(config.organizationId, retryBefore).all<Receipt>()
  return rows.results.map(row => ({ operationId: row.id, sageInvoiceId: row.sage_invoice_id,
    invoiceNumber: row.sage_invoice_number, sageJobShortName: row.sage_job_short_name }))
}

export async function recordSquareInvoiceCreator(env: CloudflareEnv, config: SquareCreatorConfiguration, observation: Observation): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT r.* FROM sage_square_payment_operations r
    WHERE r.id = ? AND r.organization_id = ? AND r.operation_type = 'post_square_receipt'`)
    .bind(observation.operationId, config.organizationId).first<Receipt>()
  if (!row || row.sage_invoice_id !== observation.sageInvoiceId || row.sage_invoice_number !== observation.invoiceNumber
    || (row.sage_job_short_name ?? "").trim().toUpperCase() !== observation.sageJobShortName.toUpperCase()) return false
  const username = observation.creatorUsername?.toLowerCase() ?? null
  if (row.sage_invoice_creator_username !== null && row.sage_invoice_creator_username !== username) return false
  await recordSageSquareInvoiceCreatorStatement(env.DB, {
    operationId: row.id, organizationId: config.organizationId, username, checkedAt: observation.checkedAt,
  }).run()
  // Never alter posting status, amounts, or the write queue from this path.
  return true
}

type Recipient = { readonly id: string; readonly role: string; readonly in_app: number }

/** Active internal staff who can read finance and have in-app notifications on. */
export async function authorizedFinanceStaff(env: CloudflareEnv, organizationId: string): Promise<readonly Recipient[]> {
  // Match the organization-scoped effective role used by auth/project access,
  // not a possibly stale or broader global account role.
  const members = await env.DB.prepare(`SELECT u.id, m.role, COALESCE(pref.in_app_enabled, 1) AS in_app
    FROM users u JOIN organization_members m ON m.user_id = u.id
    JOIN organizations o ON o.id = m.organization_id
    LEFT JOIN notification_preferences pref ON pref.user_id = u.id
    WHERE m.organization_id = ? AND o.type = 'internal' AND o.is_active = 1 AND u.is_active = 1`)
    .bind(organizationId).all<Recipient>()
  return members.results.filter(member => isInternalStaffRole(member.role)
    && getPermissions(member.role, "finance").includes("read") && member.in_app === 1)
}

// Posted receipts retain succeeded status after a later refund/change warning.
// Recheck inside the atomic write, not only when selecting work for delivery.
const DELIVERABLE = `SELECT 1 FROM sage_square_payment_operations
  WHERE id = ? AND organization_id = ? AND invoice_creator_notified_at IS NULL
    AND error_message IS NULL AND status IN ${OPEN_STATUSES}`

async function persistAlert(env: CloudflareEnv, config: SquareCreatorConfiguration, row: Receipt,
  recipients: readonly Recipient[], routed: boolean, now: string): Promise<boolean> {
  if (recipients.length === 0) return false
  const eventId = `square-creator:${config.organizationId}:${row.id}:${routed ? "received" : "routing"}`
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(row.amount_cents / 100)
  const inSage = row.status === "succeeded" || row.status === "already_in_sage"
  const title = routed ? `Square payment received for Sage invoice ${row.sage_invoice_number}` : "Match a Sage login to a Compass person"
  const body = routed
    ? `Square received ${amount} for Sage invoice ${row.sage_invoice_number}. The invoice and payment are linked in this project's Financials tab. ${inSage ? "The receipt is in Sage." : "The receipt still needs entering in Sage."}`
    : `Square received ${amount} for Sage invoice ${row.sage_invoice_number}, created in Sage by "${row.sage_invoice_creator_username ?? "unknown"}". That Sage login isn't matched to a Compass person with finance access, so they weren't told. Match it in Settings → Workflows → Square and Sage payments.`
  const statements = [insertInternalNotificationEventWhereStatement(env.DB, {
    id: eventId, organizationId: config.organizationId, projectId: row.project_id,
    eventType: routed ? "sage.square_payment.received" : "sage.square_payment.creator_routing",
    sourceType: "sage_square_payment", sourceId: row.id, title, body,
    href: `/dashboard/projects/${encodeURIComponent(row.project_id)}/financials?squareReceipt=${encodeURIComponent(row.id)}`,
    priority: routed ? "normal" : "high", createdAt: now,
  }, { sql: `EXISTS (${DELIVERABLE})`, binds: [row.id, config.organizationId] })]
  for (const recipient of recipients) {
    statements.push(insertNotificationRecipientWhereStatement(env.DB, {
      id: `${eventId}:${recipient.id}`, eventId, userId: recipient.id, createdAt: now,
    }, { sql: `EXISTS (${DELIVERABLE}) AND EXISTS (SELECT 1 FROM notification_events WHERE id = ?)`, binds: [row.id, config.organizationId, eventId] }))
  }
  if (routed) {
    statements.push(markSageSquareCreatorNotifiedStatement(env.DB, {
      operationId: row.id, organizationId: config.organizationId, eventId, openStatuses: OPEN_STATUSES, now,
    }))
    statements.push(settleNotificationRecipientsWhereStatement(env.DB, {
      markRead: true, now,
      where: { sql: `event_id = ? AND EXISTS (SELECT 1 FROM sage_square_payment_operations
        WHERE id = ? AND organization_id = ? AND invoice_creator_notified_at IS NOT NULL)`,
      binds: [`square-creator:${config.organizationId}:${row.id}:routing`, row.id, config.organizationId] },
    }))
  }
  // Deterministic IDs + one transaction make overlapping cron/report deliveries
  // idempotent and let a failed recipient insert retry without losing the alert.
  const results = await env.DB.batch(statements)
  return routed && results[recipients.length + 1]?.meta.changes === 1
}

/**
 * Tells the original Sage invoice creator that Square received the payment.
 * Does nothing until at least one Sage login is matched in Settings.
 */
export async function reconcileSquareInvoiceCreatorAlerts(env: CloudflareEnv): Promise<number> {
  const config = await squareCreatorAlertConfiguration(env)
  if (!config || config.mappings.size === 0) return 0
  const rows = await env.DB.prepare(`SELECT r.* ${ELIGIBLE}
    AND r.invoice_creator_notified_at IS NULL AND r.invoice_creator_lookup_at IS NOT NULL
    AND (r.sage_invoice_creator_username IN (SELECT json_extract(value, '$.sageUsername') FROM json_each(?))
      OR NOT EXISTS (SELECT 1 FROM notification_events e WHERE e.id = 'square-creator:' || r.organization_id || ':' || r.id || ':routing'))
    ORDER BY r.payment_completed_at LIMIT 50`)
    .bind(config.organizationId, config.from, JSON.stringify([...config.mappings.keys()].map(sageUsername => ({ sageUsername })))).all<Receipt>()
  if (rows.results.length === 0) return 0
  const authorized = await authorizedFinanceStaff(env, config.organizationId)
  // Unmatched creators go to the people chosen for Square payment alerts.
  const fallbackIds = new Set(await squareAlertRecipientIds(getDb(env.DB), env, config.organizationId, "payments"))
  const fallback = authorized.filter(member => fallbackIds.has(member.id))
  let sent = 0
  for (const row of rows.results) {
    const mappedId = row.sage_invoice_creator_username === null ? null : config.mappings.get(row.sage_invoice_creator_username)
    const employee = authorized.find(member => member.id === mappedId)
    const delivered = await persistAlert(env, config, row, employee ? [employee] : fallback, employee !== undefined, new Date().toISOString())
    if (delivered) sent += 1
  }
  return sent
}
