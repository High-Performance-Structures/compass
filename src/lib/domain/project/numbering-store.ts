import type { SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { IndexColumn, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { projectNumberAliases, projectNumberReservations, projectNumberRetirements, projectRouteAliases } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

/*
 * The only code that inserts, updates or deletes project numbering: number aliases, reservations, retirements and route aliases
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

// ---- projectNumberAliases

type ProjectNumberAliasInsert = typeof projectNumberAliases.$inferInsert
type ProjectNumberAliasPatch = SQLiteUpdateSetSource<typeof projectNumberAliases>

export function insertProjectNumberAliasStatement(db: Db, values: ProjectNumberAliasInsert | readonly ProjectNumberAliasInsert[]): Statement {
  return isRows(values) ? db.insert(projectNumberAliases).values([...values]) : db.insert(projectNumberAliases).values(values)
}

export async function insertProjectNumberAlias(db: Db, values: ProjectNumberAliasInsert | readonly ProjectNumberAliasInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectNumberAliases).values([...values]).run() : db.insert(projectNumberAliases).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectNumberAliasIfAbsentStatement(
  db: Db,
  values: ProjectNumberAliasInsert | readonly ProjectNumberAliasInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectNumberAliases).values([...values]).onConflictDoNothing(config)
    : db.insert(projectNumberAliases).values(values).onConflictDoNothing(config)
}

export async function insertProjectNumberAliasIfAbsent(
  db: Db,
  values: ProjectNumberAliasInsert | readonly ProjectNumberAliasInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectNumberAliases).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectNumberAliases).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectNumberAliasStatement(
  db: Db,
  values: ProjectNumberAliasInsert | readonly ProjectNumberAliasInsert[],
  conflict: Upsert<ProjectNumberAliasPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectNumberAliases).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectNumberAliases).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectNumberAlias(
  db: Db,
  values: ProjectNumberAliasInsert | readonly ProjectNumberAliasInsert[],
  conflict: Upsert<ProjectNumberAliasPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectNumberAliases).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectNumberAliases).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectNumberAliasesStatement(db: Db, where: SQL | undefined, patch: ProjectNumberAliasPatch): Statement {
  return db.update(projectNumberAliases).set(patch).where(where)
}

export async function updateProjectNumberAliases(db: Db, where: SQL | undefined, patch: ProjectNumberAliasPatch): Promise<D1Result> {
  return db.update(projectNumberAliases).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectNumberAliasesReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectNumberAliasPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectNumberAliases).set(patch).where(where).returning({ id: projectNumberAliases.id })
}

export function deleteProjectNumberAliasesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectNumberAliases).where(where)
}

export async function deleteProjectNumberAliases(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectNumberAliases).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectNumberAliasesReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectNumberAliases).where(where).returning({ id: projectNumberAliases.id })
}

// ---- projectNumberReservations

type ProjectNumberReservationInsert = typeof projectNumberReservations.$inferInsert
type ProjectNumberReservationPatch = SQLiteUpdateSetSource<typeof projectNumberReservations>

export function insertProjectNumberReservationStatement(db: Db, values: ProjectNumberReservationInsert | readonly ProjectNumberReservationInsert[]): Statement {
  return isRows(values) ? db.insert(projectNumberReservations).values([...values]) : db.insert(projectNumberReservations).values(values)
}

export async function insertProjectNumberReservation(db: Db, values: ProjectNumberReservationInsert | readonly ProjectNumberReservationInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectNumberReservations).values([...values]).run() : db.insert(projectNumberReservations).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectNumberReservationIfAbsentStatement(
  db: Db,
  values: ProjectNumberReservationInsert | readonly ProjectNumberReservationInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectNumberReservations).values([...values]).onConflictDoNothing(config)
    : db.insert(projectNumberReservations).values(values).onConflictDoNothing(config)
}

export async function insertProjectNumberReservationIfAbsent(
  db: Db,
  values: ProjectNumberReservationInsert | readonly ProjectNumberReservationInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectNumberReservations).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectNumberReservations).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectNumberReservationStatement(
  db: Db,
  values: ProjectNumberReservationInsert | readonly ProjectNumberReservationInsert[],
  conflict: Upsert<ProjectNumberReservationPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectNumberReservations).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectNumberReservations).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectNumberReservation(
  db: Db,
  values: ProjectNumberReservationInsert | readonly ProjectNumberReservationInsert[],
  conflict: Upsert<ProjectNumberReservationPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectNumberReservations).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectNumberReservations).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectNumberReservationsStatement(db: Db, where: SQL | undefined, patch: ProjectNumberReservationPatch): Statement {
  return db.update(projectNumberReservations).set(patch).where(where)
}

export async function updateProjectNumberReservations(db: Db, where: SQL | undefined, patch: ProjectNumberReservationPatch): Promise<D1Result> {
  return db.update(projectNumberReservations).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectNumberReservationsReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectNumberReservationPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectNumberReservations).set(patch).where(where).returning({ id: projectNumberReservations.id })
}

export function deleteProjectNumberReservationsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectNumberReservations).where(where)
}

export async function deleteProjectNumberReservations(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectNumberReservations).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectNumberReservationsReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectNumberReservations).where(where).returning({ id: projectNumberReservations.id })
}

// ---- projectNumberRetirements

type ProjectNumberRetirementInsert = typeof projectNumberRetirements.$inferInsert
type ProjectNumberRetirementPatch = SQLiteUpdateSetSource<typeof projectNumberRetirements>

export function insertProjectNumberRetirementStatement(db: Db, values: ProjectNumberRetirementInsert | readonly ProjectNumberRetirementInsert[]): Statement {
  return isRows(values) ? db.insert(projectNumberRetirements).values([...values]) : db.insert(projectNumberRetirements).values(values)
}

export async function insertProjectNumberRetirement(db: Db, values: ProjectNumberRetirementInsert | readonly ProjectNumberRetirementInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectNumberRetirements).values([...values]).run() : db.insert(projectNumberRetirements).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectNumberRetirementIfAbsentStatement(
  db: Db,
  values: ProjectNumberRetirementInsert | readonly ProjectNumberRetirementInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectNumberRetirements).values([...values]).onConflictDoNothing(config)
    : db.insert(projectNumberRetirements).values(values).onConflictDoNothing(config)
}

export async function insertProjectNumberRetirementIfAbsent(
  db: Db,
  values: ProjectNumberRetirementInsert | readonly ProjectNumberRetirementInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectNumberRetirements).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectNumberRetirements).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectNumberRetirementStatement(
  db: Db,
  values: ProjectNumberRetirementInsert | readonly ProjectNumberRetirementInsert[],
  conflict: Upsert<ProjectNumberRetirementPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectNumberRetirements).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectNumberRetirements).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectNumberRetirement(
  db: Db,
  values: ProjectNumberRetirementInsert | readonly ProjectNumberRetirementInsert[],
  conflict: Upsert<ProjectNumberRetirementPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectNumberRetirements).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectNumberRetirements).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectNumberRetirementsStatement(db: Db, where: SQL | undefined, patch: ProjectNumberRetirementPatch): Statement {
  return db.update(projectNumberRetirements).set(patch).where(where)
}

export async function updateProjectNumberRetirements(db: Db, where: SQL | undefined, patch: ProjectNumberRetirementPatch): Promise<D1Result> {
  return db.update(projectNumberRetirements).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectNumberRetirementsReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectNumberRetirementPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectNumberRetirements).set(patch).where(where).returning({ id: projectNumberRetirements.id })
}

export function deleteProjectNumberRetirementsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectNumberRetirements).where(where)
}

export async function deleteProjectNumberRetirements(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectNumberRetirements).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectNumberRetirementsReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectNumberRetirements).where(where).returning({ id: projectNumberRetirements.id })
}

// ---- projectRouteAliases

type ProjectRouteAliasInsert = typeof projectRouteAliases.$inferInsert
type ProjectRouteAliasPatch = SQLiteUpdateSetSource<typeof projectRouteAliases>

export function insertProjectRouteAliasStatement(db: Db, values: ProjectRouteAliasInsert | readonly ProjectRouteAliasInsert[]): Statement {
  return isRows(values) ? db.insert(projectRouteAliases).values([...values]) : db.insert(projectRouteAliases).values(values)
}

export async function insertProjectRouteAlias(db: Db, values: ProjectRouteAliasInsert | readonly ProjectRouteAliasInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectRouteAliases).values([...values]).run() : db.insert(projectRouteAliases).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectRouteAliasIfAbsentStatement(
  db: Db,
  values: ProjectRouteAliasInsert | readonly ProjectRouteAliasInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectRouteAliases).values([...values]).onConflictDoNothing(config)
    : db.insert(projectRouteAliases).values(values).onConflictDoNothing(config)
}

export async function insertProjectRouteAliasIfAbsent(
  db: Db,
  values: ProjectRouteAliasInsert | readonly ProjectRouteAliasInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectRouteAliases).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectRouteAliases).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectRouteAliasStatement(
  db: Db,
  values: ProjectRouteAliasInsert | readonly ProjectRouteAliasInsert[],
  conflict: Upsert<ProjectRouteAliasPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectRouteAliases).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectRouteAliases).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectRouteAlias(
  db: Db,
  values: ProjectRouteAliasInsert | readonly ProjectRouteAliasInsert[],
  conflict: Upsert<ProjectRouteAliasPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectRouteAliases).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectRouteAliases).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectRouteAliasesStatement(db: Db, where: SQL | undefined, patch: ProjectRouteAliasPatch): Statement {
  return db.update(projectRouteAliases).set(patch).where(where)
}

export async function updateProjectRouteAliases(db: Db, where: SQL | undefined, patch: ProjectRouteAliasPatch): Promise<D1Result> {
  return db.update(projectRouteAliases).set(patch).where(where).run()
}


export function deleteProjectRouteAliasesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectRouteAliases).where(where)
}

export async function deleteProjectRouteAliases(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectRouteAliases).where(where).run()
}

