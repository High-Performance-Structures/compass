import { z } from "zod/v4"

import { getJarvisEnvValue } from "@/lib/jarvis/auth"
import { getPermissions } from "@/lib/permissions"
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
type Configuration = {
  readonly organizationId: string
  readonly from: string
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

// A deployment-controlled exact ID mapping is deliberate: names/emails are not
// reliable authorization boundaries for accounting notifications.
export function squareCreatorAlertConfiguration(env: CloudflareEnv): Configuration | null {
  const organizationId = getJarvisEnvValue(env, "SAGE_SQUARE_ORGANIZATION_ID")
  const raw = getJarvisEnvValue(env, "SAGE_INVOICE_CREATOR_USER_MAP")
  const from = getJarvisEnvValue(env, "SAGE_SQUARE_CREATOR_ALERTS_FROM")
  if (!organizationId || !raw || !from || !z.iso.datetime().safeParse(from).success) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  const parsed = mappingSchema.safeParse(value)
  if (!parsed.success) return null
  const mappings = new Map<string, string>()
  for (const row of parsed.data) {
    const username = row.sageUsername.toLowerCase()
    if (mappings.has(username)) return null
    mappings.set(username, row.userId)
  }
  return { organizationId, from: new Date(from).toISOString(), mappings }
}

// Require the exact imported invoice, payment, allocation, and project scope.
// A queued receipt alone is not proof that financial import completed.
const ELIGIBLE = `FROM sage_square_payment_operations r
  JOIN projects p ON p.id = r.project_id AND p.organization_id = r.organization_id
    AND upper(trim(p.project_number)) = upper(trim(r.sage_job_short_name))
  JOIN invoices i ON i.organization_id = r.organization_id AND i.project_id = r.project_id
    AND i.source_system = 'sage' AND i.source_external_id = 'sage-ar-invoice:' || r.sage_invoice_id
    AND i.invoice_number = r.sage_invoice_number
  JOIN payments pay ON pay.organization_id = r.organization_id AND pay.project_id = r.project_id
    AND pay.source_system = 'sage' AND pay.source_external_id = 'square-payment:' || r.square_payment_id
  WHERE r.organization_id = ? AND r.operation_type = 'post_square_receipt'
    AND r.status IN ('queued', 'running', 'manual_action_required', 'succeeded')
    AND r.error_message IS NULL
    AND r.currency = 'USD' AND r.amount_cents > 0 AND r.payment_completed_at >= ?
    AND EXISTS (SELECT 1 FROM invoice_payment_allocations a WHERE a.payment_id = pay.id AND a.invoice_id = i.id
      AND a.organization_id = r.organization_id AND a.project_id = r.project_id)`

export async function pendingSquareInvoiceCreators(env: CloudflareEnv): Promise<readonly {
  readonly operationId: string
  readonly sageInvoiceId: string
  readonly invoiceNumber: string
  readonly sageJobShortName: string
}[]> {
  const config = squareCreatorAlertConfiguration(env)
  if (!config) return []
  const retryBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const rows = await env.DB.prepare(`SELECT r.* ${ELIGIBLE}
    AND r.invoice_creator_notified_at IS NULL
    AND r.sage_invoice_creator_username IS NULL
    AND (r.invoice_creator_lookup_at IS NULL OR r.invoice_creator_lookup_at < ?)
    ORDER BY r.payment_completed_at LIMIT 10`).bind(config.organizationId, config.from, retryBefore).all<Receipt>()
  return rows.results.map(row => ({ operationId: row.id, sageInvoiceId: row.sage_invoice_id,
    invoiceNumber: row.sage_invoice_number, sageJobShortName: row.sage_job_short_name }))
}

export async function recordSquareInvoiceCreator(env: CloudflareEnv, observation: Observation): Promise<boolean> {
  const config = squareCreatorAlertConfiguration(env)
  if (!config) return false
  const row = await env.DB.prepare(`SELECT r.* ${ELIGIBLE} AND r.id = ?`)
    .bind(config.organizationId, config.from, observation.operationId).first<Receipt>()
  if (!row || row.sage_invoice_id !== observation.sageInvoiceId || row.sage_invoice_number !== observation.invoiceNumber
    || row.sage_job_short_name.trim().toUpperCase() !== observation.sageJobShortName.toUpperCase()) return false
  const username = observation.creatorUsername?.toLowerCase() ?? null
  if (row.sage_invoice_creator_username !== null && row.sage_invoice_creator_username !== username) return false
  await env.DB.prepare(`UPDATE sage_square_payment_operations
    SET sage_invoice_creator_username = COALESCE(sage_invoice_creator_username, ?), invoice_creator_lookup_at = ?
    WHERE id = ? AND organization_id = ? AND invoice_creator_notified_at IS NULL
      AND (sage_invoice_creator_username IS NULL OR sage_invoice_creator_username = ?)
      AND (invoice_creator_lookup_at IS NULL OR invoice_creator_lookup_at < ?)`)
    .bind(username, observation.checkedAt, row.id, config.organizationId, username, observation.checkedAt).run()
  // Never alter posting status, amounts, or the write queue from this path.
  return true
}

type Recipient = { readonly id: string; readonly role: string; readonly in_app: number }

// Posted receipts retain succeeded status after a later refund/change warning.
// Recheck inside the atomic write, not only when selecting work for delivery.
const DELIVERABLE = `SELECT 1 FROM sage_square_payment_operations
  WHERE id = ? AND organization_id = ? AND invoice_creator_notified_at IS NULL
    AND error_message IS NULL AND status IN ('queued', 'running', 'manual_action_required', 'succeeded')`

async function persistAlert(env: CloudflareEnv, config: Configuration, row: Receipt,
  recipients: readonly Recipient[], routed: boolean, now: string): Promise<boolean> {
  if (recipients.length === 0) return false
  const eventId = `square-creator:${config.organizationId}:${row.id}:${routed ? "received" : "routing"}`
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(row.amount_cents / 100)
  const title = routed ? `Square payment received for Sage invoice ${row.sage_invoice_number}` : "Square payment employee alert needs routing"
  const body = routed
    ? `Square received ${amount} for Sage invoice ${row.sage_invoice_number}. The invoice and payment are linked in this project's Financials tab. ${row.status === "succeeded" ? "The Sage receipt is posted." : "Receipt posting in Sage is still a separate accounting step; this is not a request for payment approval."}`
    : `Square received ${amount} for Sage invoice ${row.sage_invoice_number}, but its original Sage invoice creator could not be routed to an active, authorized Compass employee with in-app notifications enabled. Review the protected Sage employee mapping and notification preferences. Payment posting is not blocked.`
  const statements = [env.DB.prepare(`INSERT INTO notification_events
    (id, organization_id, project_id, event_type, source_type, source_id, title, body, href, priority, audience, created_at)
    SELECT ?, ?, ?, ?, 'sage_square_payment', ?, ?, ?, ?, ?, 'internal', ?
    WHERE EXISTS (${DELIVERABLE}) ON CONFLICT(id) DO NOTHING`)
    .bind(eventId, config.organizationId, row.project_id, routed ? "sage.square_payment.received" : "sage.square_payment.creator_routing",
      row.id, title, body, `/dashboard/projects/${encodeURIComponent(row.project_id)}/financials?squareReceipt=${encodeURIComponent(row.id)}`,
      routed ? "normal" : "high", now, row.id, config.organizationId)]
  for (const recipient of recipients) {
    statements.push(env.DB.prepare(`INSERT INTO notification_recipients (id, event_id, user_id, in_app, email, sms, push, created_at)
      SELECT ?, ?, ?, 1, 0, 0, 0, ? WHERE EXISTS (${DELIVERABLE})
      AND EXISTS (SELECT 1 FROM notification_events WHERE id = ?) ON CONFLICT(id) DO NOTHING`)
      .bind(`${eventId}:${recipient.id}`, eventId, recipient.id, now, row.id, config.organizationId, eventId))
  }
  if (routed) {
    statements.push(env.DB.prepare(`UPDATE sage_square_payment_operations SET invoice_creator_notified_at = ?
      WHERE id = ? AND organization_id = ? AND invoice_creator_notified_at IS NULL
        AND error_message IS NULL AND status IN ('queued', 'running', 'manual_action_required', 'succeeded')
        AND EXISTS (SELECT 1 FROM notification_recipients WHERE event_id = ?)`).bind(now, row.id, config.organizationId, eventId))
    statements.push(env.DB.prepare(`UPDATE notification_recipients SET read_at = COALESCE(read_at, ?), dismissed_at = COALESCE(dismissed_at, ?)
      WHERE event_id = ? AND EXISTS (SELECT 1 FROM sage_square_payment_operations
        WHERE id = ? AND organization_id = ? AND invoice_creator_notified_at IS NOT NULL)`).bind(now, now, `square-creator:${config.organizationId}:${row.id}:routing`, row.id, config.organizationId))
  }
  // Deterministic IDs + one transaction make overlapping cron/report deliveries
  // idempotent and let a failed recipient insert retry without losing the alert.
  const results = await env.DB.batch(statements)
  return routed && results[recipients.length + 1]?.meta.changes === 1
}

export async function reconcileSquareInvoiceCreatorAlerts(env: CloudflareEnv): Promise<number> {
  const config = squareCreatorAlertConfiguration(env)
  if (!config) return 0
  const rows = await env.DB.prepare(`SELECT r.* ${ELIGIBLE}
    AND r.invoice_creator_notified_at IS NULL AND r.invoice_creator_lookup_at IS NOT NULL
    AND (r.sage_invoice_creator_username IN (SELECT json_extract(value, '$.sageUsername') FROM json_each(?))
      OR NOT EXISTS (SELECT 1 FROM notification_events e WHERE e.id = 'square-creator:' || r.organization_id || ':' || r.id || ':routing'))
    ORDER BY r.payment_completed_at LIMIT 50`)
    .bind(config.organizationId, config.from, JSON.stringify([...config.mappings.keys()].map(sageUsername => ({ sageUsername })))).all<Receipt>()
  // Match the organization-scoped effective role used by auth/project access,
  // not a possibly stale or broader global account role.
  const members = await env.DB.prepare(`SELECT u.id, m.role, COALESCE(pref.in_app_enabled, 1) AS in_app
    FROM users u JOIN organization_members m ON m.user_id = u.id
    JOIN organizations o ON o.id = m.organization_id
    LEFT JOIN notification_preferences pref ON pref.user_id = u.id
    WHERE m.organization_id = ? AND o.type = 'internal' AND o.is_active = 1 AND u.is_active = 1`)
    .bind(config.organizationId).all<Recipient>()
  const authorized = members.results.filter(member => isInternalStaffRole(member.role)
    && getPermissions(member.role, "finance").includes("read") && member.in_app === 1)
  const admins = authorized.filter(member => member.role === "admin" || member.role === "secondary_admin")
  let sent = 0
  for (const row of rows.results) {
    const mappedId = row.sage_invoice_creator_username === null ? null : config.mappings.get(row.sage_invoice_creator_username)
    const employee = authorized.find(member => member.id === mappedId)
    const delivered = await persistAlert(env, config, row, employee ? [employee] : admins, employee !== undefined, new Date().toISOString())
    if (delivered) sent += 1
  }
  return sent
}
