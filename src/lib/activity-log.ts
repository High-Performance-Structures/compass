import { activityEvents } from "@/db/schema"
import type { getDb } from "@/db"

export const ACTIVITY_CATEGORIES = [
  "access",
  "account",
  "conversation",
  "email",
  "file",
  "financial",
  "presence",
  "schedule",
  "social",
  "warranty",
] as const

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]

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
  readonly category: ActivityCategory
  readonly action: string
  readonly entityType: string
  readonly entityId?: string | null
  readonly summary: string
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>
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
