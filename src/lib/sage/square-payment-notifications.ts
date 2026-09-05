import { and, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  notificationEvents,
  organizationMembers,
  users,
} from "@/db/schema"
import { createSystemNotificationEvent } from "@/lib/notifications/events"

const ADMIN_ROLES = ["admin", "secondary_admin"]
const EXCEPTION_EVENT_TYPE = "sage.square_payment.exception"
const MANUAL_RECEIPT_EVENT_TYPE = "sage.square_payment.manual_receipt"
const EXCEPTION_SOURCE_TYPE = "sage_square_payment"

type SageSquareAdminNotificationInput = {
  readonly eventType: string
  readonly sourceId: string
  readonly title: string
  readonly body: string
  readonly priority: "normal" | "high"
}

export type SageSquareManualReceiptNotificationInput = {
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
    .select({ organizationId: notificationEvents.organizationId })
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.eventType, input.eventType),
        eq(notificationEvents.sourceType, EXCEPTION_SOURCE_TYPE),
        eq(notificationEvents.sourceId, input.sourceId)
      )
    )
  const notifiedOrganizations = new Set(
    existing.map((event) => event.organizationId)
  )
  const admins = await db
    .select({
      organizationId: organizationMembers.organizationId,
      userId: users.id,
      email: users.email,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(users.isActive, true), inArray(users.role, ADMIN_ROLES)))
  const byOrganization = new Map<
    string,
    { readonly userId: string; readonly email: string }[]
  >()
  for (const admin of admins) {
    const recipients = byOrganization.get(admin.organizationId) ?? []
    recipients.push({ userId: admin.userId, email: admin.email })
    byOrganization.set(admin.organizationId, recipients)
  }
  for (const [organizationId, recipients] of byOrganization) {
    if (notifiedOrganizations.has(organizationId)) continue
    await createSystemNotificationEvent({
      organizationId,
      projectId: null,
      eventType: input.eventType,
      sourceType: EXCEPTION_SOURCE_TYPE,
      sourceId: input.sourceId,
      title: input.title,
      body: input.body,
      href: "/dashboard/financials?tab=payments",
      priority: input.priority,
      audience: "internal",
      recipients,
      delivery: { inApp: true, email: false, push: false },
    })
  }
}

export async function notifySageSquareException(
  env: CloudflareEnv,
  sourceId: string,
  title: string,
  body: string
): Promise<void> {
  await notifySageSquareAdmins(env, {
    eventType: EXCEPTION_EVENT_TYPE,
    sourceId,
    title,
    body,
    priority: "high",
  })
}

export async function notifySageSquareManualReceipt(
  env: CloudflareEnv,
  input: SageSquareManualReceiptNotificationInput
): Promise<void> {
  await notifySageSquareAdmins(env, {
    eventType: MANUAL_RECEIPT_EVENT_TYPE,
    sourceId: input.squarePaymentId,
    title: `Post Square payment for Sage invoice ${input.sageInvoiceNumber}`,
    body: manualReceiptNotificationBody(input),
    priority: "high",
  })
}
