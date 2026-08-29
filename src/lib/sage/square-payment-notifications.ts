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
const EXCEPTION_SOURCE_TYPE = "sage_square_payment"

export async function notifySageSquareException(
  env: CloudflareEnv,
  sourceId: string,
  title: string,
  body: string
): Promise<void> {
  const db = getDb(env.DB)
  const existing = await db
    .select({ organizationId: notificationEvents.organizationId })
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.eventType, EXCEPTION_EVENT_TYPE),
        eq(notificationEvents.sourceType, EXCEPTION_SOURCE_TYPE),
        eq(notificationEvents.sourceId, sourceId)
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
      eventType: EXCEPTION_EVENT_TYPE,
      sourceType: EXCEPTION_SOURCE_TYPE,
      sourceId,
      title,
      body,
      href: "/dashboard/financials",
      priority: "high",
      audience: "internal",
      recipients,
      delivery: { inApp: true, email: false, push: false },
    })
  }
}
