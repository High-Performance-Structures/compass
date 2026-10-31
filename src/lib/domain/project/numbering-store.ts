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

function isRows<T extends object>(values: T | readonly T[]): values is readonly T[] {
  return Array.isArray(values)
}

// ---- projectNumberAliases

type ProjectNumberAliasInsert = typeof projectNumberAliases.$inferInsert

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

// ---- projectNumberReservations

type ProjectNumberReservationInsert = typeof projectNumberReservations.$inferInsert
type ProjectNumberReservationPatch = SQLiteUpdateSetSource<typeof projectNumberReservations>

export function insertProjectNumberReservationStatement(db: Db, values: ProjectNumberReservationInsert | readonly ProjectNumberReservationInsert[]): Statement {
  return isRows(values) ? db.insert(projectNumberReservations).values([...values]) : db.insert(projectNumberReservations).values(values)
}

export function updateProjectNumberReservationsStatement(db: Db, where: SQL | undefined, patch: ProjectNumberReservationPatch): Statement {
  return db.update(projectNumberReservations).set(patch).where(where)
}

export function deleteProjectNumberReservationsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectNumberReservations).where(where)
}

// ---- projectNumberRetirements

type ProjectNumberRetirementInsert = typeof projectNumberRetirements.$inferInsert

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

export function deleteProjectNumberRetirementsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectNumberRetirements).where(where)
}

// ---- projectRouteAliases

type ProjectRouteAliasInsert = typeof projectRouteAliases.$inferInsert
type ProjectRouteAliasPatch = SQLiteUpdateSetSource<typeof projectRouteAliases>

export function insertProjectRouteAliasStatement(db: Db, values: ProjectRouteAliasInsert | readonly ProjectRouteAliasInsert[]): Statement {
  return isRows(values) ? db.insert(projectRouteAliases).values([...values]) : db.insert(projectRouteAliases).values(values)
}

export function updateProjectRouteAliasesStatement(db: Db, where: SQL | undefined, patch: ProjectRouteAliasPatch): Statement {
  return db.update(projectRouteAliases).set(patch).where(where)
}

export function deleteProjectRouteAliasesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectRouteAliases).where(where)
}

