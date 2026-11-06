/**
 * The only code that reads and writes organization_record_statuses
 * (architecture standard, section 1): each company's status options per
 * record type, from Settings › Statuses. Every read and write is scoped to
 * one organization in SQL. Callers resolve who is asking first; this store
 * enforces the status rules themselves (built-in statuses are never deleted,
 * a status in use is never deleted) so no caller can skip them.
 */
import { and, count, eq, inArray } from "drizzle-orm"

import { projectOperations, projectRfis, projects } from "@/db/schema"
import { organizationRecordStatuses } from "@/db/schema-record-statuses"
import { assertListFields } from "@/lib/shared/statuses"
import type { Db } from "@/lib/server/action-context"

import { RECORD_STATUS_REGISTRY } from "./registry"
import {
  defaultRecordStatusList,
  planRecordStatusDelete,
  planRecordStatusSave,
  recordStatusKey,
  resolveRecordStatuses,
  type RecordStatusEdit,
  type RecordStatusList,
  type StoredRecordStatus,
} from "./rules"
import { RECORD_STATUS_COLORS, RECORD_STATUS_GROUPS, RECORD_STATUS_TYPES, type RecordStatusType } from "./statuses"

const LIST_RULES = {
  recordType: RECORD_STATUS_TYPES,
  color: RECORD_STATUS_COLORS,
  statusGroup: RECORD_STATUS_GROUPS,
}

const storedColumns = {
  recordType: organizationRecordStatuses.recordType,
  statusKey: organizationRecordStatuses.statusKey,
  label: organizationRecordStatuses.label,
  color: organizationRecordStatuses.color,
  statusGroup: organizationRecordStatuses.statusGroup,
  sortOrder: organizationRecordStatuses.sortOrder,
  showAsButton: organizationRecordStatuses.showAsButton,
  hidden: organizationRecordStatuses.hidden,
  builtIn: organizationRecordStatuses.builtIn,
}

async function storedRows(db: Db, organizationId: string, type: RecordStatusType): Promise<readonly StoredRecordStatus[]> {
  return db
    .select(storedColumns)
    .from(organizationRecordStatuses)
    .where(and(eq(organizationRecordStatuses.organizationId, organizationId), eq(organizationRecordStatuses.recordType, type)))
}

/**
 * A record type's statuses for the company: its rows merged over the code
 * defaults. Lists keep working on the code defaults when the rows cannot be
 * read (for example before migration 0294 is applied).
 */
export async function loadRecordStatusList(db: Db, organizationId: string, type: RecordStatusType): Promise<RecordStatusList> {
  try {
    return resolveRecordStatuses(type, await storedRows(db, organizationId, type))
  } catch (error) {
    console.error("[record-statuses] using code defaults; company statuses could not be read", error)
    return defaultRecordStatusList(type)
  }
}

/**
 * A record type's statuses for the company that owns a project, for readers
 * that start from a project id. Code defaults when the rows cannot be read.
 */
export async function loadRecordStatusListForProject(db: Db, projectId: string, type: RecordStatusType): Promise<RecordStatusList> {
  try {
    const rows = await db
      .select(storedColumns)
      .from(organizationRecordStatuses)
      .where(
        and(
          inArray(organizationRecordStatuses.organizationId, db.select({ id: projects.organizationId }).from(projects).where(eq(projects.id, projectId))),
          eq(organizationRecordStatuses.recordType, type),
        ),
      )
    return resolveRecordStatuses(type, rows)
  } catch (error) {
    console.error("[record-statuses] using code defaults; company statuses could not be read", error)
    return defaultRecordStatusList(type)
  }
}

/** Every record type's statuses for the company, in one read (Settings › Statuses). */
export async function loadAllRecordStatusLists(db: Db, organizationId: string): Promise<readonly RecordStatusList[]> {
  const rows = await db
    .select(storedColumns)
    .from(organizationRecordStatuses)
    .where(eq(organizationRecordStatuses.organizationId, organizationId))
    .catch((error: unknown) => {
      // Before migration 0294 every list keeps its code defaults.
      console.error("[record-statuses] using code defaults; company statuses could not be read", error)
      return []
    })
  return RECORD_STATUS_TYPES.map((type) => resolveRecordStatuses(type, rows.filter((row) => row.recordType === type)))
}

/**
 * How many of the company's records of this type carry the status, in any
 * spelling the status list reads as it. The distinct stored statuses are
 * counted in SQL (a handful of values) and matched through the list here.
 */
export async function countRecordsWithStatus(
  db: Db,
  organizationId: string,
  type: RecordStatusType,
  key: string,
  statuses?: RecordStatusList,
): Promise<number> {
  const storage = RECORD_STATUS_REGISTRY[type].records
  const counts =
    storage.table === "project_rfis"
      ? await db
          .select({ status: projectRfis.status, value: count() })
          .from(projectRfis)
          .innerJoin(projects, eq(projects.id, projectRfis.projectId))
          .where(eq(projects.organizationId, organizationId))
          .groupBy(projectRfis.status)
      : await db
          .select({ status: projectOperations.status, value: count() })
          .from(projectOperations)
          .innerJoin(projects, eq(projects.id, projectOperations.projectId))
          .where(
            and(
              eq(projects.organizationId, organizationId),
              inArray(projectOperations.sourceRecordType, [...storage.sourceRecordTypes]),
            ),
          )
          .groupBy(projectOperations.status)
  const list = statuses ?? (await loadRecordStatusList(db, organizationId, type))
  return counts.reduce((total, row) => total + (recordStatusKey(list, row.status) === key ? row.value : 0), 0)
}

export type RecordStatusWrite =
  | { readonly ok: true; readonly before: RecordStatusList; readonly after: RecordStatusList }
  | { readonly ok: false; readonly error: string }

/**
 * Saves one record type's whole status list for the company, in its order.
 * Refused (nothing written) when it would drop a built-in or saved status.
 */
export async function saveRecordStatusList(
  db: Db,
  organizationId: string,
  type: RecordStatusType,
  edits: readonly RecordStatusEdit[],
  now: string,
): Promise<RecordStatusWrite> {
  const stored = await storedRows(db, organizationId, type)
  const plan = planRecordStatusSave(type, stored, edits)
  if (!plan.ok) return plan
  const values = plan.value.map((row) => ({
    id: crypto.randomUUID(),
    organizationId,
    recordType: type,
    ...row,
    createdAt: now,
    updatedAt: now,
  }))
  assertListFields("organization_record_statuses", values, LIST_RULES)
  const [first, ...rest] = values.map((value) =>
    db
      .insert(organizationRecordStatuses)
      .values(value)
      .onConflictDoUpdate({
        target: [organizationRecordStatuses.organizationId, organizationRecordStatuses.recordType, organizationRecordStatuses.statusKey],
        set: {
          label: value.label,
          color: value.color,
          statusGroup: value.statusGroup,
          sortOrder: value.sortOrder,
          showAsButton: value.showAsButton,
          hidden: value.hidden,
          builtIn: value.builtIn,
          updatedAt: now,
        },
      }),
  )
  if (first) await db.batch([first, ...rest])
  return {
    ok: true,
    before: resolveRecordStatuses(type, stored),
    after: resolveRecordStatuses(type, plan.value),
  }
}

/**
 * Deletes a company-added status. Refused for a built-in status, a status
 * another company owns (it is not found here), or one any record uses.
 */
export async function deleteRecordStatus(
  db: Db,
  organizationId: string,
  type: RecordStatusType,
  key: string,
): Promise<RecordStatusWrite> {
  const stored = await storedRows(db, organizationId, type)
  const exists = stored.some((row) => row.statusKey === key)
  const inUse = exists ? await countRecordsWithStatus(db, organizationId, type, key, resolveRecordStatuses(type, stored)) : 0
  const plan = planRecordStatusDelete(type, stored, key, inUse)
  if (!plan.ok) return plan
  await db
    .delete(organizationRecordStatuses)
    .where(
      and(
        eq(organizationRecordStatuses.organizationId, organizationId),
        eq(organizationRecordStatuses.recordType, type),
        eq(organizationRecordStatuses.statusKey, key),
        eq(organizationRecordStatuses.builtIn, false),
      ),
    )
  return {
    ok: true,
    before: resolveRecordStatuses(type, stored),
    after: resolveRecordStatuses(type, stored.filter((row) => row.statusKey !== key)),
  }
}
