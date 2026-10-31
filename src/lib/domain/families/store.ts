import type { SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

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

function isRows<T extends object>(values: T | readonly T[]): values is readonly T[] {
  return Array.isArray(values)
}

// ---- projectFamilies

type ProjectFamilyInsert = typeof projectFamilies.$inferInsert
type ProjectFamilyPatch = SQLiteUpdateSetSource<typeof projectFamilies>

export function insertProjectFamilyStatement(db: Db, values: ProjectFamilyInsert | readonly ProjectFamilyInsert[]): Statement {
  return isRows(values) ? db.insert(projectFamilies).values([...values]) : db.insert(projectFamilies).values(values)
}

export function updateProjectFamiliesStatement(db: Db, where: SQL | undefined, patch: ProjectFamilyPatch): Statement {
  return db.update(projectFamilies).set(patch).where(where)
}

export async function updateProjectFamilies(db: Db, where: SQL | undefined, patch: ProjectFamilyPatch): Promise<D1Result> {
  return db.update(projectFamilies).set(patch).where(where).run()
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

export function updateProjectFamilyPhasesStatement(db: Db, where: SQL | undefined, patch: ProjectFamilyPhasePatch): Statement {
  return db.update(projectFamilyPhases).set(patch).where(where)
}

export async function updateProjectFamilyPhases(db: Db, where: SQL | undefined, patch: ProjectFamilyPhasePatch): Promise<D1Result> {
  return db.update(projectFamilyPhases).set(patch).where(where).run()
}

