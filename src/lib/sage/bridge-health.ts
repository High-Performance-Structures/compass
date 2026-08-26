import { and, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  notificationEvents,
  organizationMembers,
  users,
} from "@/db/schema"
import { sageBridgeStatus } from "@/db/schema-sage"
import { createSystemNotificationEvent } from "@/lib/notifications/events"

export const SAGE_BRIDGE_HEARTBEAT_MAX_AGE_MILLISECONDS = 5 * 60 * 1000

const ADMIN_ROLES = ["admin", "secondary_admin"]
const HEALTH_SOURCE_TYPE = "sage_bridge_health"
const OFFLINE_EVENT_TYPE = "sage_bridge.offline"

type SageBridgeHealthCheckResult = {
  readonly checked: number
  readonly offline: number
  readonly notificationsCreated: number
}

export function isSageBridgeHeartbeatOnline(
  lastSeenAt: string | null,
  now = Date.now()
): boolean {
  if (lastSeenAt === null) return false
  const timestamp = Date.parse(lastSeenAt)
  return (
    Number.isFinite(timestamp) &&
    now >= timestamp &&
    now - timestamp <= SAGE_BRIDGE_HEARTBEAT_MAX_AGE_MILLISECONDS
  )
}

function bridgeLabel(id: string): string {
  if (id === "pay-application-poller") return "Sage pay-application bridge"
  if (id === "client-project-writer") return "Sage client/project writer"
  return "Sage bridge"
}

function incidentSourceId(id: string, lastSeenAt: string): string {
  return `${id}:${lastSeenAt}`
}

export async function runSageBridgeHealthCheck(
  env: CloudflareEnv,
  now = new Date()
): Promise<SageBridgeHealthCheckResult> {
  const db = getDb(env.DB)
  const heartbeats = await db
    .select({
      id: sageBridgeStatus.id,
      lastSeenAt: sageBridgeStatus.lastSeenAt,
    })
    .from(sageBridgeStatus)
  const offline = heartbeats.filter(
    (heartbeat) =>
      !isSageBridgeHeartbeatOnline(heartbeat.lastSeenAt, now.getTime())
  )
  if (offline.length === 0) {
    return { checked: heartbeats.length, offline: 0, notificationsCreated: 0 }
  }

  const admins = await db
    .select({
      organizationId: organizationMembers.organizationId,
      userId: users.id,
      email: users.email,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(eq(users.isActive, true), inArray(users.role, ADMIN_ROLES))
    )
  if (admins.length === 0) {
    return {
      checked: heartbeats.length,
      offline: offline.length,
      notificationsCreated: 0,
    }
  }

  const sourceIds = offline.map((heartbeat) =>
    incidentSourceId(heartbeat.id, heartbeat.lastSeenAt)
  )
  const existing = await db
    .select({
      organizationId: notificationEvents.organizationId,
      sourceId: notificationEvents.sourceId,
    })
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.eventType, OFFLINE_EVENT_TYPE),
        eq(notificationEvents.sourceType, HEALTH_SOURCE_TYPE),
        inArray(notificationEvents.sourceId, sourceIds)
      )
    )
  const notified = new Set(
    existing.flatMap((event) =>
      event.sourceId === null
        ? []
        : [`${event.organizationId}:${event.sourceId}`]
    )
  )
  const recipientsByOrganization = new Map<
    string,
    { readonly userId: string; readonly email: string }[]
  >()
  for (const admin of admins) {
    const recipients = recipientsByOrganization.get(admin.organizationId)
    const recipient = { userId: admin.userId, email: admin.email }
    if (recipients) recipients.push(recipient)
    else recipientsByOrganization.set(admin.organizationId, [recipient])
  }

  let notificationsCreated = 0
  for (const heartbeat of offline) {
    const sourceId = incidentSourceId(heartbeat.id, heartbeat.lastSeenAt)
    for (const [organizationId, recipients] of recipientsByOrganization) {
      if (notified.has(`${organizationId}:${sourceId}`)) continue
      await createSystemNotificationEvent({
        organizationId,
        projectId: null,
        eventType: OFFLINE_EVENT_TYPE,
        sourceType: HEALTH_SOURCE_TYPE,
        sourceId,
        title: `${bridgeLabel(heartbeat.id)} is offline`,
        body: `No authenticated heartbeat has been received since ${heartbeat.lastSeenAt}. Sage sync requests will not run until the bridge reconnects.`,
        href: "/dashboard/automations",
        priority: "high",
        audience: "internal",
        recipients,
        delivery: { inApp: true, email: false, push: false },
      })
      notificationsCreated += 1
    }
  }

  return {
    checked: heartbeats.length,
    offline: offline.length,
    notificationsCreated,
  }
}
