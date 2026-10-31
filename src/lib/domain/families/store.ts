import type { SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { IndexColumn, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { projectFamilies, projectFamilyPhases } from "@/db/schema-project-families"
import type { Db } from "@/lib/server/action-context"

/*
 * The only code that inserts, updates or deletes project families and their phases
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

// ---- projectFamilies

type ProjectFamilyInsert = typeof projectFamilies.$inferInsert
type ProjectFamilyPatch = SQLiteUpdateSetSource<typeof projectFamilies>

export function insertProjectFamilyStatement(db: Db, values: ProjectFamilyInsert | readonly ProjectFamilyInsert[]): Statement {
  return isRows(values) ? db.insert(projectFamilies).values([...values]) : db.insert(projectFamilies).values(values)
}

export async function insertProjectFamily(db: Db, values: ProjectFamilyInsert | readonly ProjectFamilyInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectFamilies).values([...values]).run() : db.insert(projectFamilies).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectFamilyIfAbsentStatement(
  db: Db,
  values: ProjectFamilyInsert | readonly ProjectFamilyInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectFamilies).values([...values]).onConflictDoNothing(config)
    : db.insert(projectFamilies).values(values).onConflictDoNothing(config)
}

export async function insertProjectFamilyIfAbsent(
  db: Db,
  values: ProjectFamilyInsert | readonly ProjectFamilyInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectFamilies).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectFamilies).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectFamilyStatement(
  db: Db,
  values: ProjectFamilyInsert | readonly ProjectFamilyInsert[],
  conflict: Upsert<ProjectFamilyPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectFamilies).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectFamilies).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectFamily(
  db: Db,
  values: ProjectFamilyInsert | readonly ProjectFamilyInsert[],
  conflict: Upsert<ProjectFamilyPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectFamilies).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectFamilies).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectFamiliesStatement(db: Db, where: SQL | undefined, patch: ProjectFamilyPatch): Statement {
  return db.update(projectFamilies).set(patch).where(where)
}

export async function updateProjectFamilies(db: Db, where: SQL | undefined, patch: ProjectFamilyPatch): Promise<D1Result> {
  return db.update(projectFamilies).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectFamiliesReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectFamilyPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectFamilies).set(patch).where(where).returning({ id: projectFamilies.id })
}

export function deleteProjectFamiliesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectFamilies).where(where)
}

export async function deleteProjectFamilies(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectFamilies).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectFamiliesReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectFamilies).where(where).returning({ id: projectFamilies.id })
}

// ---- projectFamilyPhases

type ProjectFamilyPhaseInsert = typeof projectFamilyPhases.$inferInsert
type ProjectFamilyPhasePatch = SQLiteUpdateSetSource<typeof projectFamilyPhases>

export function insertProjectFamilyPhaseStatement(db: Db, values: ProjectFamilyPhaseInsert | readonly ProjectFamilyPhaseInsert[]): Statement {
  return isRows(values) ? db.insert(projectFamilyPhases).values([...values]) : db.insert(projectFamilyPhases).values(values)
}

export async function insertProjectFamilyPhase(db: Db, values: ProjectFamilyPhaseInsert | readonly ProjectFamilyPhaseInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectFamilyPhases).values([...values]).run() : db.insert(projectFamilyPhases).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectFamilyPhaseIfAbsentStatement(
  db: Db,
  values: ProjectFamilyPhaseInsert | readonly ProjectFamilyPhaseInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectFamilyPhases).values([...values]).onConflictDoNothing(config)
    : db.insert(projectFamilyPhases).values(values).onConflictDoNothing(config)
}

export async function insertProjectFamilyPhaseIfAbsent(
  db: Db,
  values: ProjectFamilyPhaseInsert | readonly ProjectFamilyPhaseInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectFamilyPhases).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectFamilyPhases).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectFamilyPhaseStatement(
  db: Db,
  values: ProjectFamilyPhaseInsert | readonly ProjectFamilyPhaseInsert[],
  conflict: Upsert<ProjectFamilyPhasePatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectFamilyPhases).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectFamilyPhases).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectFamilyPhase(
  db: Db,
  values: ProjectFamilyPhaseInsert | readonly ProjectFamilyPhaseInsert[],
  conflict: Upsert<ProjectFamilyPhasePatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectFamilyPhases).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectFamilyPhases).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectFamilyPhasesStatement(db: Db, where: SQL | undefined, patch: ProjectFamilyPhasePatch): Statement {
  return db.update(projectFamilyPhases).set(patch).where(where)
}

export async function updateProjectFamilyPhases(db: Db, where: SQL | undefined, patch: ProjectFamilyPhasePatch): Promise<D1Result> {
  return db.update(projectFamilyPhases).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectFamilyPhasesReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectFamilyPhasePatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectFamilyPhases).set(patch).where(where).returning({ id: projectFamilyPhases.id })
}

export function deleteProjectFamilyPhasesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectFamilyPhases).where(where)
}

export async function deleteProjectFamilyPhases(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectFamilyPhases).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectFamilyPhasesReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectFamilyPhases).where(where).returning({ id: projectFamilyPhases.id })
}
