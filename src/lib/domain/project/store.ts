import type { SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { IndexColumn, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { projectExternalLinks, projectJobStatuses, projectMembers, projects } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

/*
 * The only code that inserts, updates or deletes the project tables: projects, project members, project job statuses and project external links
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

// ---- projects

type ProjectInsert = typeof projects.$inferInsert
type ProjectPatch = SQLiteUpdateSetSource<typeof projects>

export function insertProjectStatement(db: Db, values: ProjectInsert | readonly ProjectInsert[]): Statement {
  return isRows(values) ? db.insert(projects).values([...values]) : db.insert(projects).values(values)
}

export async function insertProject(db: Db, values: ProjectInsert | readonly ProjectInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projects).values([...values]).run() : db.insert(projects).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectIfAbsentStatement(
  db: Db,
  values: ProjectInsert | readonly ProjectInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projects).values([...values]).onConflictDoNothing(config)
    : db.insert(projects).values(values).onConflictDoNothing(config)
}

export async function insertProjectIfAbsent(
  db: Db,
  values: ProjectInsert | readonly ProjectInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projects).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projects).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectStatement(
  db: Db,
  values: ProjectInsert | readonly ProjectInsert[],
  conflict: Upsert<ProjectPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projects).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projects).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProject(
  db: Db,
  values: ProjectInsert | readonly ProjectInsert[],
  conflict: Upsert<ProjectPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projects).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projects).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectsStatement(db: Db, where: SQL | undefined, patch: ProjectPatch): Statement {
  return db.update(projects).set(patch).where(where)
}

export async function updateProjects(db: Db, where: SQL | undefined, patch: ProjectPatch): Promise<D1Result> {
  return db.update(projects).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectsReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projects).set(patch).where(where).returning({ id: projects.id })
}

export function deleteProjectsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projects).where(where)
}

export async function deleteProjects(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projects).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectsReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projects).where(where).returning({ id: projects.id })
}

// ---- projectMembers

type ProjectMemberInsert = typeof projectMembers.$inferInsert
type ProjectMemberPatch = SQLiteUpdateSetSource<typeof projectMembers>

export function insertProjectMemberStatement(db: Db, values: ProjectMemberInsert | readonly ProjectMemberInsert[]): Statement {
  return isRows(values) ? db.insert(projectMembers).values([...values]) : db.insert(projectMembers).values(values)
}

export async function insertProjectMember(db: Db, values: ProjectMemberInsert | readonly ProjectMemberInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectMembers).values([...values]).run() : db.insert(projectMembers).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectMemberIfAbsentStatement(
  db: Db,
  values: ProjectMemberInsert | readonly ProjectMemberInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectMembers).values([...values]).onConflictDoNothing(config)
    : db.insert(projectMembers).values(values).onConflictDoNothing(config)
}

export async function insertProjectMemberIfAbsent(
  db: Db,
  values: ProjectMemberInsert | readonly ProjectMemberInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectMembers).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectMembers).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectMemberStatement(
  db: Db,
  values: ProjectMemberInsert | readonly ProjectMemberInsert[],
  conflict: Upsert<ProjectMemberPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectMembers).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectMembers).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectMember(
  db: Db,
  values: ProjectMemberInsert | readonly ProjectMemberInsert[],
  conflict: Upsert<ProjectMemberPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectMembers).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectMembers).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectMembersStatement(db: Db, where: SQL | undefined, patch: ProjectMemberPatch): Statement {
  return db.update(projectMembers).set(patch).where(where)
}

export async function updateProjectMembers(db: Db, where: SQL | undefined, patch: ProjectMemberPatch): Promise<D1Result> {
  return db.update(projectMembers).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectMembersReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectMemberPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectMembers).set(patch).where(where).returning({ id: projectMembers.id })
}

export function deleteProjectMembersStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectMembers).where(where)
}

export async function deleteProjectMembers(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectMembers).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectMembersReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectMembers).where(where).returning({ id: projectMembers.id })
}

// ---- projectJobStatuses

type ProjectJobStatusInsert = typeof projectJobStatuses.$inferInsert
type ProjectJobStatusPatch = SQLiteUpdateSetSource<typeof projectJobStatuses>

export function insertProjectJobStatusStatement(db: Db, values: ProjectJobStatusInsert | readonly ProjectJobStatusInsert[]): Statement {
  return isRows(values) ? db.insert(projectJobStatuses).values([...values]) : db.insert(projectJobStatuses).values(values)
}

export async function insertProjectJobStatus(db: Db, values: ProjectJobStatusInsert | readonly ProjectJobStatusInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectJobStatuses).values([...values]).run() : db.insert(projectJobStatuses).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectJobStatusIfAbsentStatement(
  db: Db,
  values: ProjectJobStatusInsert | readonly ProjectJobStatusInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectJobStatuses).values([...values]).onConflictDoNothing(config)
    : db.insert(projectJobStatuses).values(values).onConflictDoNothing(config)
}

export async function insertProjectJobStatusIfAbsent(
  db: Db,
  values: ProjectJobStatusInsert | readonly ProjectJobStatusInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectJobStatuses).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectJobStatuses).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectJobStatusStatement(
  db: Db,
  values: ProjectJobStatusInsert | readonly ProjectJobStatusInsert[],
  conflict: Upsert<ProjectJobStatusPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectJobStatuses).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectJobStatuses).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectJobStatus(
  db: Db,
  values: ProjectJobStatusInsert | readonly ProjectJobStatusInsert[],
  conflict: Upsert<ProjectJobStatusPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectJobStatuses).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectJobStatuses).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectJobStatusesStatement(db: Db, where: SQL | undefined, patch: ProjectJobStatusPatch): Statement {
  return db.update(projectJobStatuses).set(patch).where(where)
}

export async function updateProjectJobStatuses(db: Db, where: SQL | undefined, patch: ProjectJobStatusPatch): Promise<D1Result> {
  return db.update(projectJobStatuses).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectJobStatusesReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectJobStatusPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectJobStatuses).set(patch).where(where).returning({ id: projectJobStatuses.id })
}

export function deleteProjectJobStatusesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectJobStatuses).where(where)
}

export async function deleteProjectJobStatuses(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectJobStatuses).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectJobStatusesReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectJobStatuses).where(where).returning({ id: projectJobStatuses.id })
}

// ---- projectExternalLinks

type ProjectExternalLinkInsert = typeof projectExternalLinks.$inferInsert
type ProjectExternalLinkPatch = SQLiteUpdateSetSource<typeof projectExternalLinks>

export function insertProjectExternalLinkStatement(db: Db, values: ProjectExternalLinkInsert | readonly ProjectExternalLinkInsert[]): Statement {
  return isRows(values) ? db.insert(projectExternalLinks).values([...values]) : db.insert(projectExternalLinks).values(values)
}

export async function insertProjectExternalLink(db: Db, values: ProjectExternalLinkInsert | readonly ProjectExternalLinkInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectExternalLinks).values([...values]).run() : db.insert(projectExternalLinks).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectExternalLinkIfAbsentStatement(
  db: Db,
  values: ProjectExternalLinkInsert | readonly ProjectExternalLinkInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectExternalLinks).values([...values]).onConflictDoNothing(config)
    : db.insert(projectExternalLinks).values(values).onConflictDoNothing(config)
}

export async function insertProjectExternalLinkIfAbsent(
  db: Db,
  values: ProjectExternalLinkInsert | readonly ProjectExternalLinkInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectExternalLinks).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectExternalLinks).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectExternalLinkStatement(
  db: Db,
  values: ProjectExternalLinkInsert | readonly ProjectExternalLinkInsert[],
  conflict: Upsert<ProjectExternalLinkPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectExternalLinks).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectExternalLinks).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectExternalLink(
  db: Db,
  values: ProjectExternalLinkInsert | readonly ProjectExternalLinkInsert[],
  conflict: Upsert<ProjectExternalLinkPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectExternalLinks).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectExternalLinks).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectExternalLinksStatement(db: Db, where: SQL | undefined, patch: ProjectExternalLinkPatch): Statement {
  return db.update(projectExternalLinks).set(patch).where(where)
}

export async function updateProjectExternalLinks(db: Db, where: SQL | undefined, patch: ProjectExternalLinkPatch): Promise<D1Result> {
  return db.update(projectExternalLinks).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectExternalLinksReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectExternalLinkPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectExternalLinks).set(patch).where(where).returning({ id: projectExternalLinks.id })
}

export function deleteProjectExternalLinksStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectExternalLinks).where(where)
}

export async function deleteProjectExternalLinks(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectExternalLinks).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectExternalLinksReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectExternalLinks).where(where).returning({ id: projectExternalLinks.id })
}
