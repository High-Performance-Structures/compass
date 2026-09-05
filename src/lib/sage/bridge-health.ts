import { and, eq, inArray, isNull } from "drizzle-orm"

import { getDb } from "@/db"
import {
  notificationEvents,
  notificationRecipients,
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
  readonly notificationsResolved: number
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
  if (id === "square-payment-writer") return "Sage Square payment writer"
  return "Sage bridge"
}

function incidentSourceId(id: string, lastSeenAt: string): string {
  return `${id}:${lastSeenAt}`
}

type SageBridgeIncidentRecipient = {
  readonly recipientId: string
  readonly sourceId: string | null
}

type SageBridgeHeartbeatObservation = {
  readonly id: string
  readonly lastSeenAt: string
}

export function recoveredSageBridgeRecipientIds(
  incidents: readonly SageBridgeIncidentRecipient[],
  onlineHeartbeats: readonly SageBridgeHeartbeatObservation[]
): string[] {
  return incidents.flatMap((incident) => {
    if (incident.sourceId === null) return []
    for (const heartbeat of onlineHeartbeats) {
      const prefix = `${heartbeat.id}:`
      if (!incident.sourceId.startsWith(prefix)) continue
      const incidentTimestamp = Date.parse(incident.sourceId.slice(prefix.length))
      const recoveryTimestamp = Date.parse(heartbeat.lastSeenAt)
      if (
        Number.isFinite(incidentTimestamp) &&
        Number.isFinite(recoveryTimestamp) &&
        recoveryTimestamp > incidentTimestamp
      ) {
        return [incident.recipientId]
      }
    }
    return []
  })
}

async function dismissRecoveredNotifications(
  env: CloudflareEnv,
  onlineHeartbeats: readonly SageBridgeHeartbeatObservation[],
  dismissedAt: string
): Promise<number> {
  if (onlineHeartbeats.length === 0) return 0
  const db = getDb(env.DB)
  const activeIncidents = await db
    .select({
      recipientId: notificationRecipients.id,
      sourceId: notificationEvents.sourceId,
    })
    .from(notificationRecipients)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, notificationRecipients.eventId)
    )
    .where(
      and(
        eq(notificationEvents.eventType, OFFLINE_EVENT_TYPE),
        eq(notificationEvents.sourceType, HEALTH_SOURCE_TYPE),
        isNull(notificationRecipients.dismissedAt)
      )
    )
  const recipientIds = recoveredSageBridgeRecipientIds(
    activeIncidents,
    onlineHeartbeats
  )
  let resolved = 0
  for (let offset = 0; offset < recipientIds.length; offset += 75) {
    const chunk = recipientIds.slice(offset, offset + 75)
    const updated = await db
      .update(notificationRecipients)
      .set({ dismissedAt })
      .where(
        and(
          inArray(notificationRecipients.id, chunk),
          isNull(notificationRecipients.dismissedAt)
        )
      )
      .returning({ id: notificationRecipients.id })
    resolved += updated.length
  }
  return resolved
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
  const offlineIds = new Set(offline.map((heartbeat) => heartbeat.id))
  const onlineHeartbeats = heartbeats.flatMap((heartbeat) =>
    offlineIds.has(heartbeat.id) ? [] : [heartbeat]
  )
  const notificationsResolved = await dismissRecoveredNotifications(
    env,
    onlineHeartbeats,
    now.toISOString()
  )
  if (offline.length === 0) {
    return {
      checked: heartbeats.length,
      offline: 0,
      notificationsCreated: 0,
      notificationsResolved,
    }
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
      notificationsResolved,
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
    notificationsResolved,
  }
}
