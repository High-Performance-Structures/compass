import type { SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { IndexColumn, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import {
  projectExternalLinks,
  projectJobStatuses,
  projectMembers,
  projectProfileSyncOperations,
  projects,
} from "@/db/schema"
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

// ---- projectProfileSyncOperations (Drive folder rename / tracker row retries)

type ProjectProfileSyncOperationInsert = typeof projectProfileSyncOperations.$inferInsert
type ProjectProfileSyncOperationPatch = SQLiteUpdateSetSource<typeof projectProfileSyncOperations>

export function insertProjectProfileSyncOperationStatement(
  db: Db,
  values: ProjectProfileSyncOperationInsert | readonly ProjectProfileSyncOperationInsert[],
): Statement {
  return isRows(values)
    ? db.insert(projectProfileSyncOperations).values([...values])
    : db.insert(projectProfileSyncOperations).values(values)
}

export async function updateProjectProfileSyncOperations(
  db: Db,
  where: SQL | undefined,
  patch: ProjectProfileSyncOperationPatch,
): Promise<D1Result> {
  return db.update(projectProfileSyncOperations).set(patch).where(where).run()
}

// ---- Sage client/project write results

/**
 * Records the Sage job a confirmed client/project write created, as a
 * prepared statement for the Sage bridge's raw D1 batch.
 */
export function sageJobResultStatement(
  d1: D1Database,
  input: {
    readonly projectId: string
    readonly sageJobId: SageJobResultValue
    readonly sageJobNumber: SageJobResultValue
    readonly sageJobStatusNumber: SageJobResultValue
    readonly sageJobTypeNumber: SageJobResultValue
    readonly now: string
  },
): D1PreparedStatement {
  return d1
    .prepare(
      `UPDATE projects
         SET sage_job_id = ?, sage_job_number = ?,
             sage_job_status_number = ?, sage_job_type_number = ?, updated_at = ?
         WHERE id = ?`
    )
    .bind(
      input.sageJobId,
      input.sageJobNumber,
      input.sageJobStatusNumber,
      input.sageJobTypeNumber,
      input.now,
      input.projectId
    )
}

/** A value the Sage bridge reports, bound as is. */
type SageJobResultValue = string | number | null

// ---- Buildertrend lead/project cutover script

/*
 * SQL text for the Buildertrend lead/project cutover script
 * (src/lib/buildertrend/lead-project-cutover.ts). These build the script's
 * `projects` statements as text for a reviewed migration file; nothing here
 * runs them.
 */

export type BuildertrendCutoverProject = {
  readonly projectId: string
  readonly projectName: string
  readonly projectNumber: string | undefined
  readonly googleDriveProjectFolderId: string | undefined
  readonly clientName: string | undefined
}

/** A SQL string literal, or NULL for a missing or empty value. */
function cutoverSqlText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "NULL"
  return `'${value.replaceAll("'", "''")}'`
}

export function buildertrendCutoverNewProjectSql(
  organizationId: string,
  project: BuildertrendCutoverProject,
  capturedAt: string,
): string {
  return `INSERT INTO projects (
  id, project_number, name, status, client_status, job_status_id, client_name,
  organization_id, google_drive_folder_id, owner_updates_enabled,
  owner_update_channel, owner_update_cadence, owner_schedule_view,
  created_at, updated_at
) SELECT
  ${cutoverSqlText(project.projectId)}, ${cutoverSqlText(project.projectNumber)},
  ${cutoverSqlText(project.projectName)}, 'OPEN', 'lead', 'current',
  ${cutoverSqlText(project.clientName)}, ${cutoverSqlText(organizationId)},
  ${cutoverSqlText(project.googleDriveProjectFolderId)}, 0, 'compass', 'weekly', 'items',
  ${cutoverSqlText(capturedAt)}, ${cutoverSqlText(capturedAt)}
WHERE EXISTS (
  SELECT 1 FROM organizations WHERE id = ${cutoverSqlText(organizationId)}
)
ON CONFLICT(id) DO UPDATE SET
  google_drive_folder_id = COALESCE(
    projects.google_drive_folder_id,
    excluded.google_drive_folder_id
  ),
  updated_at = CASE
    WHEN projects.organization_id = excluded.organization_id
      THEN excluded.updated_at
    ELSE projects.updated_at
  END
WHERE projects.organization_id = excluded.organization_id;`
}

export function buildertrendCutoverProjectCollisionGuardSql(
  organizationId: string,
  project: BuildertrendCutoverProject,
  capturedAt: string,
): string {
  const projectNumberConflict = project.projectNumber
    ? `OR EXISTS (
    SELECT 1 FROM projects
    WHERE organization_id = ${cutoverSqlText(organizationId)}
      AND project_number = ${cutoverSqlText(project.projectNumber)} COLLATE NOCASE
      AND id <> ${cutoverSqlText(project.projectId)}
  )`
    : ""
  return `-- Fail closed if a new Buildertrend project would reuse an existing identity.
INSERT INTO projects (id, name, status, organization_id, created_at, updated_at)
SELECT NULL, 'Buildertrend cutover collision guard', 'OPEN',
  ${cutoverSqlText(organizationId)}, ${cutoverSqlText(capturedAt)}, ${cutoverSqlText(capturedAt)}
WHERE EXISTS (
  SELECT 1 FROM projects
  WHERE id = ${cutoverSqlText(project.projectId)}
    AND organization_id <> ${cutoverSqlText(organizationId)}
)
OR EXISTS (
  SELECT 1 FROM projects
  WHERE organization_id = ${cutoverSqlText(organizationId)}
    AND google_drive_folder_id = ${cutoverSqlText(project.googleDriveProjectFolderId)}
    AND id <> ${cutoverSqlText(project.projectId)}
)
${projectNumberConflict};`
}

export function buildertrendCutoverProjectReferenceGuardSql(
  organizationId: string,
  project: BuildertrendCutoverProject,
  capturedAt: string,
): string {
  return `-- Fail closed rather than staging a lead against a nonexistent Compass project.
INSERT INTO projects (id, name, status, organization_id, created_at, updated_at)
SELECT NULL, 'Buildertrend cutover project reference guard', 'OPEN',
  ${cutoverSqlText(organizationId)}, ${cutoverSqlText(capturedAt)}, ${cutoverSqlText(capturedAt)}
WHERE NOT EXISTS (
  SELECT 1 FROM projects
  WHERE id = ${cutoverSqlText(project.projectId)}
    AND organization_id = ${cutoverSqlText(organizationId)}
);`
}
