/*
 * Activity entries for View as: who viewed whom, when it started and when it
 * ended, linked by the session id. Listed under Access on the Activity page.
 * The viewed person is never notified. Starting a view refuses to proceed if
 * its entry cannot be written, so no view goes unrecorded.
 */
import type { getDb } from "@/db"
import { recordRequiredActivityEvent, type ActivityActor } from "@/lib/activity-log"

type Db = ReturnType<typeof getDb>

export type ViewAsAuditInput = {
  readonly kind: "start" | "end"
  readonly sessionId: string
  readonly organizationId: string
  readonly admin: ActivityActor & { readonly id: string }
  readonly target: { readonly id: string; readonly name: string; readonly role: string }
  readonly at: string
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
    },
    createdAt: input.at,
  }
}

/** Writes the entry; throws when it cannot (callers decide whether that blocks). */
export async function writeViewAsActivity(db: Db, input: ViewAsAuditInput): Promise<void> {
  await recordRequiredActivityEvent({ db, ...viewAsActivityEvent(input) })
}
