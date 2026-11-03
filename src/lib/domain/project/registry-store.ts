import type { SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { IndexColumn, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { projectDuplicateDecisions, projectRegistryRemovals } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

/*
 * The only code that inserts, updates or deletes the project registry: registry removals and duplicate decisions
 * (architecture standard, section 1).
 *
 * Each table has the same small set of writers. `*Statement` builds an
 * unexecuted statement for `db.batch`; the plain form runs one statement.
 * Callers pass the same `where` conditions they used before, so the SQL is
 * unchanged. The store has no access rules; callers check access first.
 */

/** One statement for `db.batch([...])`. */
export type Statement = BatchItem<"sqlite">

type ConflictTarget = IndexColumn | IndexColumn[]

type Upsert<TPatch> = {
  readonly target: ConflictTarget
  readonly set: TPatch
  readonly targetWhere?: SQL
  readonly setWhere?: SQL
}

function isRows<T extends object>(values: T | readonly T[]): values is readonly T[] {
  return Array.isArray(values)
}

// ---- projectRegistryRemovals

type ProjectRegistryRemovalInsert = typeof projectRegistryRemovals.$inferInsert

export function insertProjectRegistryRemovalStatement(db: Db, values: ProjectRegistryRemovalInsert | readonly ProjectRegistryRemovalInsert[]): Statement {
  return isRows(values) ? db.insert(projectRegistryRemovals).values([...values]) : db.insert(projectRegistryRemovals).values(values)
}

export function deleteProjectRegistryRemovalsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectRegistryRemovals).where(where)
}

// ---- projectDuplicateDecisions

type ProjectDuplicateDecisionInsert = typeof projectDuplicateDecisions.$inferInsert
type ProjectDuplicateDecisionPatch = SQLiteUpdateSetSource<typeof projectDuplicateDecisions>

export function insertProjectDuplicateDecisionStatement(db: Db, values: ProjectDuplicateDecisionInsert | readonly ProjectDuplicateDecisionInsert[]): Statement {
  return isRows(values) ? db.insert(projectDuplicateDecisions).values([...values]) : db.insert(projectDuplicateDecisions).values(values)
}

export function upsertProjectDuplicateDecisionStatement(
  db: Db,
  values: ProjectDuplicateDecisionInsert | readonly ProjectDuplicateDecisionInsert[],
  conflict: Upsert<ProjectDuplicateDecisionPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectDuplicateDecisions).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectDuplicateDecisions).values(values).onConflictDoUpdate(conflict)
}

export function deleteProjectDuplicateDecisionsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectDuplicateDecisions).where(where)
}

/**
 * Upserts one decision and returns its status. An empty result means the
 * conflict's `setWhere` refused the update (for example an already merged pair).
 */
export async function upsertProjectDuplicateDecisionReturningStatus(
  db: Db,
  values: ProjectDuplicateDecisionInsert,
  conflict: Upsert<ProjectDuplicateDecisionPatch>,
): Promise<readonly { readonly status: string }[]> {
  return db
    .insert(projectDuplicateDecisions)
    .values(values)
    .onConflictDoUpdate(conflict)
    .returning({ status: projectDuplicateDecisions.status })
}
