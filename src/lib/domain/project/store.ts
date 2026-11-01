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
import { companyMoveGuard, type CompanyReferenceMove } from "@/lib/domain/contacts/company-merge-references"
import type { Db } from "@/lib/server/action-context"
import { assertListFields } from "@/lib/shared/statuses"

import { PROJECT_LISTS } from "./statuses"

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
  assertListFields("projects", values, PROJECT_LISTS)
  return isRows(values) ? db.insert(projects).values([...values]) : db.insert(projects).values(values)
}

export async function insertProject(db: Db, values: ProjectInsert | readonly ProjectInsert[]): Promise<D1Result> {
  assertListFields("projects", values, PROJECT_LISTS)
  return isRows(values) ? db.insert(projects).values([...values]).run() : db.insert(projects).values(values).run()
}

export function updateProjectsStatement(db: Db, where: SQL | undefined, patch: ProjectPatch): Statement {
  assertListFields("projects", patch, PROJECT_LISTS)
  return db.update(projects).set(patch).where(where)
}

export async function updateProjects(db: Db, where: SQL | undefined, patch: ProjectPatch): Promise<D1Result> {
  assertListFields("projects", patch, PROJECT_LISTS)
  return db.update(projects).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectsReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectPatch,
): Promise<readonly { readonly id: string }[]> {
  assertListFields("projects", patch, PROJECT_LISTS)
  return db.update(projects).set(patch).where(where).returning({ id: projects.id })
}

export function deleteProjectsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projects).where(where)
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

export async function updateProjectMembers(db: Db, where: SQL | undefined, patch: ProjectMemberPatch): Promise<D1Result> {
  return db.update(projectMembers).set(patch).where(where).run()
}

export async function deleteProjectMembers(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectMembers).where(where).run()
}

// ---- projectJobStatuses

type ProjectJobStatusInsert = typeof projectJobStatuses.$inferInsert

export async function insertProjectJobStatus(db: Db, values: ProjectJobStatusInsert | readonly ProjectJobStatusInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectJobStatuses).values([...values]).run() : db.insert(projectJobStatuses).values(values).run()
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

export function upsertProjectExternalLinkStatement(
  db: Db,
  values: ProjectExternalLinkInsert | readonly ProjectExternalLinkInsert[],
  conflict: Upsert<ProjectExternalLinkPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectExternalLinks).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectExternalLinks).values(values).onConflictDoUpdate(conflict)
}

export function updateProjectExternalLinksStatement(db: Db, where: SQL | undefined, patch: ProjectExternalLinkPatch): Statement {
  return db.update(projectExternalLinks).set(patch).where(where)
}

export async function updateProjectExternalLinks(db: Db, where: SQL | undefined, patch: ProjectExternalLinkPatch): Promise<D1Result> {
  return db.update(projectExternalLinks).set(patch).where(where).run()
}

export async function deleteProjectExternalLinks(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectExternalLinks).where(where).run()
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

/** Moves jobs whose client is a merged client company to the kept client. */
export function companyMergeProjectStatements(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement[] {
  if (move.side !== "customer") return []
  const guard = companyMoveGuard(move)
  return [database.prepare(`UPDATE projects SET client_customer_id = ?, updated_at = ? WHERE client_customer_id = ? AND organization_id = ? AND ${guard.sql}`)
    .bind(move.destinationId, move.now, move.sourceId, move.organizationId, ...guard.binds)]
}
