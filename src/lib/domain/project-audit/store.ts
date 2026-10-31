/**
 * The only writer of `project_profile_audit_events` (architecture standard,
 * section 1). Every project audit entry goes through `recordProjectAudit`.
 * No auth logic here; callers resolve access first.
 */
import { and, eq, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { projectProfileAuditEvents, projects } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

export type ProjectAuditEvent = {
  /** Defaults to a new UUID. */
  readonly id?: string
  readonly organizationId: string
  readonly projectId: string
  readonly actorUserId: string | null
  readonly eventType: string
  readonly entityType: string
  readonly entityId: string | null
  /** Already serialized, so each caller keeps its exact stored text (null stays SQL NULL). */
  readonly beforeJson: string | null
  readonly afterJson: string | null
  readonly createdAt: string
}

export type ProjectAuditOptions = {
  /**
   * Write the entry only when this condition holds, evaluated in the same
   * statement against the project row (matched on the event's project and
   * organization). Used for version guards inside a batch.
   */
  readonly onlyIf?: SQL
}

/** Awaitable on its own, or passed into a caller's `db.batch`. */
export type ProjectAuditWrite = BatchItem<"sqlite"> & PromiseLike<unknown>

export function recordProjectAudit(
  db: Db,
  event: ProjectAuditEvent,
  options: ProjectAuditOptions = {},
): ProjectAuditWrite {
  const id = event.id ?? crypto.randomUUID()
  if (!options.onlyIf) {
    return db.insert(projectProfileAuditEvents).values({
      id,
      organizationId: event.organizationId,
      projectId: event.projectId,
      actorUserId: event.actorUserId,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      beforeJson: event.beforeJson,
      afterJson: event.afterJson,
      createdAt: event.createdAt,
    })
  }
  return db.insert(projectProfileAuditEvents).select(
    db
      .select({
        id: sql<string>`${id}`.as("id"),
        organizationId: projects.organizationId,
        projectId: projects.id,
        actorUserId: sql<string | null>`${event.actorUserId}`.as("actorUserId"),
        eventType: sql<string>`${event.eventType}`.as("eventType"),
        entityType: sql<string>`${event.entityType}`.as("entityType"),
        entityId: sql<string | null>`${event.entityId}`.as("entityId"),
        beforeJson: sql<string | null>`${event.beforeJson}`.as("beforeJson"),
        afterJson: sql<string | null>`${event.afterJson}`.as("afterJson"),
        createdAt: sql<string>`${event.createdAt}`.as("createdAt"),
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, event.projectId),
          eq(projects.organizationId, event.organizationId),
          options.onlyIf,
        ),
      ),
  )
}
