import { activityEvents } from "@/db/schema"
import type { getDb } from "@/db"
import { companyMoveGuard, type CompanyReferenceMove } from "@/lib/domain/contacts/company-merge-references"

export const ACTIVITY_CATEGORIES = [
  "access",
  "account",
  "conversation",
  "email",
  "field",
  "file",
  "financial",
  "presence",
  "schedule",
  "social",
  "warranty",
] as const

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]

/**
 * Categories that are recorded but not listed on the Activity page (its
 * filter and feed only show ACTIVITY_CATEGORIES). Company settings changes
 * are kept for audit this way.
 */
type UnlistedActivityCategory = "settings"

type ActivityMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly ActivityMetadataValue[]
  | { readonly [key: string]: ActivityMetadataValue }

export type ActivityActor = {
  readonly id: string | null
  readonly email: string
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly role: string
}

type ActivityDb = ReturnType<typeof getDb>

type RecordActivityInput = {
  readonly db: ActivityDb
  readonly id?: string
  readonly organizationId: string
  readonly projectId?: string | null
  readonly actor: ActivityActor
  readonly category: ActivityCategory | UnlistedActivityCategory
  readonly action: string
  readonly entityType: string
  readonly entityId?: string | null
  readonly summary: string
  readonly metadata?: Readonly<Record<string, ActivityMetadataValue>>
  readonly createdAt?: string
}

export function activityActorName(actor: ActivityActor): string {
  const displayName = actor.displayName?.trim()
  if (displayName) return displayName

  const fullName = [actor.firstName, actor.lastName]
    .filter((value) => Boolean(value?.trim()))
    .join(" ")
    .trim()
  return fullName || actor.email
}

/**
 * Activity history must never make the underlying user action fail. The
 * caller awaits this helper so normal writes are ordered before their event,
 * while logging errors remain isolated and observable in server logs.
 */
export async function recordActivityEvent(
  input: RecordActivityInput
): Promise<void> {
  try {
    await input.db
      .insert(activityEvents)
      .values({
        id: input.id ?? crypto.randomUUID(),
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        actorUserId: input.actor.id,
        actorName: activityActorName(input.actor).slice(0, 200),
        actorRole: input.actor.role.slice(0, 80),
        category: input.category,
        action: input.action.slice(0, 120),
        entityType: input.entityType.slice(0, 120),
        entityId: input.entityId ?? null,
        summary: input.summary.trim().slice(0, 500),
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt: input.createdAt ?? new Date().toISOString(),
      })
      .run()
  } catch (error) {
    console.error("Unable to record Compass activity event", error)
  }
}

/** Moves a merged company's activity history (trade-doc requests and replies included) to the kept company. */
export function companyMergeActivityStatements(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement[] {
  const guard = companyMoveGuard(move)
  return [database.prepare(`UPDATE activity_events SET entity_id = ? WHERE entity_type = ? AND entity_id = ? AND organization_id = ? AND ${guard.sql}`)
    .bind(move.destinationId, move.side, move.sourceId, move.organizationId, ...guard.binds)]
}

type SqlPart = { readonly sql: string; readonly binds: readonly unknown[] }

/**
 * One activity row whose metadata JSON is computed by `metadata` when the
 * statement runs, inserted only while `condition` holds. A merge repair uses
 * it to record what it is about to move, ahead of the moves.
 */
export function activityEventSelectStatement(database: D1Database, input: {
  readonly organizationId: string; readonly actorUserId: string | null; readonly actorName: string; readonly actorRole: string
  readonly category: ActivityCategory; readonly action: string; readonly entityType: string; readonly entityId: string
  readonly summary: string; readonly metadata: SqlPart; readonly condition: SqlPart; readonly now: string
}): D1PreparedStatement {
  return database.prepare(`INSERT INTO activity_events (id, organization_id, project_id, actor_user_id, actor_name, actor_role, category,
      action, entity_type, entity_id, summary, metadata, created_at)
    SELECT ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ${input.metadata.sql}, ? WHERE ${input.condition.sql}`)
    .bind(crypto.randomUUID(), input.organizationId, input.actorUserId, input.actorName.slice(0, 200), input.actorRole.slice(0, 80),
      input.category, input.action.slice(0, 120), input.entityType, input.entityId, input.summary.slice(0, 500),
      ...input.metadata.binds, input.now, ...input.condition.binds)
}
