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
type ProjectRegistryRemovalPatch = SQLiteUpdateSetSource<typeof projectRegistryRemovals>

export function insertProjectRegistryRemovalStatement(db: Db, values: ProjectRegistryRemovalInsert | readonly ProjectRegistryRemovalInsert[]): Statement {
  return isRows(values) ? db.insert(projectRegistryRemovals).values([...values]) : db.insert(projectRegistryRemovals).values(values)
}

export async function insertProjectRegistryRemoval(db: Db, values: ProjectRegistryRemovalInsert | readonly ProjectRegistryRemovalInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectRegistryRemovals).values([...values]).run() : db.insert(projectRegistryRemovals).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectRegistryRemovalIfAbsentStatement(
  db: Db,
  values: ProjectRegistryRemovalInsert | readonly ProjectRegistryRemovalInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectRegistryRemovals).values([...values]).onConflictDoNothing(config)
    : db.insert(projectRegistryRemovals).values(values).onConflictDoNothing(config)
}

export async function insertProjectRegistryRemovalIfAbsent(
  db: Db,
  values: ProjectRegistryRemovalInsert | readonly ProjectRegistryRemovalInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectRegistryRemovals).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectRegistryRemovals).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectRegistryRemovalStatement(
  db: Db,
  values: ProjectRegistryRemovalInsert | readonly ProjectRegistryRemovalInsert[],
  conflict: Upsert<ProjectRegistryRemovalPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectRegistryRemovals).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectRegistryRemovals).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectRegistryRemoval(
  db: Db,
  values: ProjectRegistryRemovalInsert | readonly ProjectRegistryRemovalInsert[],
  conflict: Upsert<ProjectRegistryRemovalPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectRegistryRemovals).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectRegistryRemovals).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectRegistryRemovalsStatement(db: Db, where: SQL | undefined, patch: ProjectRegistryRemovalPatch): Statement {
  return db.update(projectRegistryRemovals).set(patch).where(where)
}

export async function updateProjectRegistryRemovals(db: Db, where: SQL | undefined, patch: ProjectRegistryRemovalPatch): Promise<D1Result> {
  return db.update(projectRegistryRemovals).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectRegistryRemovalsReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectRegistryRemovalPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectRegistryRemovals).set(patch).where(where).returning({ id: projectRegistryRemovals.id })
}

export function deleteProjectRegistryRemovalsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectRegistryRemovals).where(where)
}

export async function deleteProjectRegistryRemovals(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectRegistryRemovals).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectRegistryRemovalsReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectRegistryRemovals).where(where).returning({ id: projectRegistryRemovals.id })
}

// ---- projectDuplicateDecisions

type ProjectDuplicateDecisionInsert = typeof projectDuplicateDecisions.$inferInsert
type ProjectDuplicateDecisionPatch = SQLiteUpdateSetSource<typeof projectDuplicateDecisions>

export function insertProjectDuplicateDecisionStatement(db: Db, values: ProjectDuplicateDecisionInsert | readonly ProjectDuplicateDecisionInsert[]): Statement {
  return isRows(values) ? db.insert(projectDuplicateDecisions).values([...values]) : db.insert(projectDuplicateDecisions).values(values)
}

export async function insertProjectDuplicateDecision(db: Db, values: ProjectDuplicateDecisionInsert | readonly ProjectDuplicateDecisionInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectDuplicateDecisions).values([...values]).run() : db.insert(projectDuplicateDecisions).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectDuplicateDecisionIfAbsentStatement(
  db: Db,
  values: ProjectDuplicateDecisionInsert | readonly ProjectDuplicateDecisionInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectDuplicateDecisions).values([...values]).onConflictDoNothing(config)
    : db.insert(projectDuplicateDecisions).values(values).onConflictDoNothing(config)
}

export async function insertProjectDuplicateDecisionIfAbsent(
  db: Db,
  values: ProjectDuplicateDecisionInsert | readonly ProjectDuplicateDecisionInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectDuplicateDecisions).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectDuplicateDecisions).values(values).onConflictDoNothing(config).run()
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

export async function upsertProjectDuplicateDecision(
  db: Db,
  values: ProjectDuplicateDecisionInsert | readonly ProjectDuplicateDecisionInsert[],
  conflict: Upsert<ProjectDuplicateDecisionPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectDuplicateDecisions).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectDuplicateDecisions).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectDuplicateDecisionsStatement(db: Db, where: SQL | undefined, patch: ProjectDuplicateDecisionPatch): Statement {
  return db.update(projectDuplicateDecisions).set(patch).where(where)
}

export async function updateProjectDuplicateDecisions(db: Db, where: SQL | undefined, patch: ProjectDuplicateDecisionPatch): Promise<D1Result> {
  return db.update(projectDuplicateDecisions).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectDuplicateDecisionsReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectDuplicateDecisionPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectDuplicateDecisions).set(patch).where(where).returning({ id: projectDuplicateDecisions.id })
}

export function deleteProjectDuplicateDecisionsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectDuplicateDecisions).where(where)
}

export async function deleteProjectDuplicateDecisions(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectDuplicateDecisions).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectDuplicateDecisionsReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectDuplicateDecisions).where(where).returning({ id: projectDuplicateDecisions.id })
}
