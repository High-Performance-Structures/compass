/*
 * Activity entries for View as: who viewed whom, when it started and when it
 * ended, linked by the session id. Listed under Access on the Activity page.
 * The viewed person is never notified. Starting a view refuses to proceed if
 * its entry cannot be written, so no view goes unrecorded.
 */
import { and, eq, gte, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { activityEvents } from "@/db/schema"
import { recordRequiredActivityEvent, type ActivityActor } from "@/lib/activity-log"
import type { ViewAsTokenPayload } from "@/lib/view-as/token"

type Db = ReturnType<typeof getDb>

/**
 * How a session ended: Exit or sign-out, or found no longer allowed on a
 * later request (session.ts) and sent through /view-as/ended.
 */
export type ViewAsEndReason =
  | "exit"
  | "signed_out"
  | "expired"
  | "not_configured"
  | "other_sign_in"
  | "setting_off"
  | "not_allowed"
  | "developer_mode_off"
  | "revoked"
  | "person_unavailable"
  | "privilege"
  | "cross_site"

export type ViewAsAuditInput = {
  readonly kind: "start" | "end"
  readonly sessionId: string
  readonly organizationId: string
  readonly admin: ActivityActor & { readonly id: string }
  readonly target: { readonly id: string; readonly name: string; readonly role: string }
  readonly at: string
  readonly endedBy?: ViewAsEndReason
}

/** The Activity event for one start or end. */
function viewAsActivityEvent(input: ViewAsAuditInput): Omit<Parameters<typeof recordRequiredActivityEvent>[0], "db"> {
  const verb = input.kind === "start" ? "Started" : "Stopped"
  return {
    organizationId: input.organizationId,
    projectId: null,
    actor: input.admin,
    category: "access",
    action: input.kind === "start" ? "view_as.started" : "view_as.ended",
    entityType: "user",
    entityId: input.target.id,
    summary: `${verb} viewing Compass as ${input.target.name} (read only).`,
    metadata: {
      viewAsSessionId: input.sessionId,
      viewedUserId: input.target.id,
      viewedUserName: input.target.name,
      viewedUserRole: input.target.role || null,
      ...(input.endedBy ? { endedBy: input.endedBy } : {}),
    },
    createdAt: input.at,
  }
}

/** Writes the entry; throws when it cannot (callers decide whether that blocks). */
export async function writeViewAsActivity(db: Db, input: ViewAsAuditInput): Promise<void> {
  await recordRequiredActivityEvent({ db, ...viewAsActivityEvent(input) })
}

/**
 * Has this session already been ended (its end entry written)? Read through
 * the admin's own Activity since the session started, so it stays a small
 * indexed range (activity_events_actor_created_idx). This is what revokes a
 * session server side: a copy of the cookie is refused after Exit.
 */
export async function isViewAsSessionEnded(db: Db, payload: ViewAsTokenPayload): Promise<boolean> {
  const row = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.actorUserId, payload.adminId),
        gte(activityEvents.createdAt, new Date(payload.iat * 1000).toISOString()),
        eq(activityEvents.action, "view_as.ended"),
        sql`json_extract(${activityEvents.metadata}, '$.viewAsSessionId') = ${payload.sid}`,
      ),
    )
    .limit(1)
    .get()
  return row !== undefined
}
