/**
 * The production drift detector's database reads (issue #1329). READ-ONLY:
 * nothing here writes. Every query is small on purpose: one GROUP BY per
 * status column and the schema 50 tables per query, run a few
 * at a time. Never fold them into one big UNION; a 150-branch UNION once
 * reset the production database.
 */
import { getTableName, sql, type SQL } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

import { projects } from "@/db/schema-projects"
import { scheduleTasks } from "@/db/schema-schedule"
import { chunkD1Values } from "@/lib/d1-query"
import { loadAllRecordStatusLists } from "@/lib/domain/record-statuses/store"
import { defaultRecordStatusList, recordStatusExactKey, type RecordStatusList } from "@/lib/domain/record-statuses/rules"
import { RECORD_STATUS_TYPES } from "@/lib/domain/record-statuses/statuses"
import type { Db } from "@/lib/server/action-context"
import { cleanText, field, finiteNumber } from "@/lib/shared/guards"

import type { StatusCheck, StatusCheckOwner, StatusCheckScope } from "./check-types"
import { isInternalTable, type StatusFinding, type StatusValueCount } from "./rules"

/** How many queries run at once. */
const PARALLEL_READS = 4
/** Distinct (company, value) pairs read per status column; far above anything real. */
const MAX_VALUES_PER_CHECK = 500
/** The value reported when a column had more distinct values than the check reads. */
const TRUNCATED_VALUE = `(more than ${MAX_VALUES_PER_CHECK} distinct values; not all were read)`

/** Each company's status lists, loaded once per run. */
type StatusListCache = Map<string, Promise<readonly RecordStatusList[]>>

/** Runs `read` over `items`, a few at a time (the reads are independent). */
async function inSmallBatches<T, R>(items: readonly T[], read: (item: T) => Promise<readonly R[]>): Promise<R[]> {
  const results: R[] = []
  for (let start = 0; start < items.length; start += PARALLEL_READS) {
    const batch = await Promise.all(items.slice(start, start + PARALLEL_READS).map(read))
    for (const rows of batch) results.push(...rows)
  }
  return results
}

function ownerJoins(owner: StatusCheckOwner): { readonly joins: SQL; readonly organization: SQL } {
  const sources: SQL[] = []
  if (owner.organization) sources.push(sql`${owner.organization}`)
  let joins = sql``
  if (owner.scheduleTask) {
    joins = sql` LEFT JOIN ${scheduleTasks} ON ${scheduleTasks.id} = ${owner.scheduleTask} LEFT JOIN ${projects} ON ${projects.id} = ${scheduleTasks.projectId}`
    sources.push(sql`${projects.organizationId}`)
  } else if (owner.project) {
    joins = sql` LEFT JOIN ${projects} ON ${projects.id} = ${owner.project}`
    sources.push(sql`${projects.organizationId}`)
  }
  const organization =
    sources.length === 0 ? sql`NULL` : sources.length === 1 ? sources[0] : sql`COALESCE(${sql.join(sources, sql`, `)})`
  return { joins, organization }
}

function scopeCondition(scope: StatusCheckScope | undefined): SQL {
  if (!scope) return sql`1 = 1`
  if ("isNotNull" in scope) return sql`${scope.column} IS NOT NULL`
  if (scope.equals.length === 0) return sql`1 = 0`
  return sql`${scope.column} IN (${sql.join(scope.equals.map((value) => sql`${value}`), sql`, `)})`
}

function valueCounts(rows: readonly unknown[]): StatusValueCount[] {
  return rows.flatMap((row) => {
    const rowCount = finiteNumber(field(row, "row_count"))
    if (rowCount === null) return []
    const value = field(row, "value")
    return [{ organizationId: cleanText(field(row, "organization_id")), value: typeof value === "string" ? value : null, rows: rowCount }]
  })
}

/**
 * Stored values of one column per company. With `allowed`, only values
 * outside it (and empty ones) are returned, so a clean column returns nothing.
 */
async function readValueCounts(
  db: Db,
  input: { readonly column: AnySQLiteColumn; readonly owner: StatusCheckOwner; readonly scope?: StatusCheckScope; readonly allowed?: readonly string[] },
): Promise<StatusValueCount[]> {
  const { joins, organization } = ownerJoins(input.owner)
  const outside = input.allowed
    ? input.allowed.length === 0
      ? sql`1 = 1`
      : sql`(${input.column} IS NULL OR ${input.column} NOT IN (${sql.join(input.allowed.map((value) => sql`${value}`), sql`, `)}))`
    : sql`1 = 1`
  const rows = await db.all(sql`SELECT ${organization} AS organization_id, ${input.column} AS value, COUNT(*) AS row_count
    FROM ${input.column.table}${joins}
    WHERE ${scopeCondition(input.scope)} AND ${outside}
    GROUP BY 1, 2
    LIMIT ${MAX_VALUES_PER_CHECK}`)
  const counts = valueCounts(rows)
  // Never silently short: say so when the cap cut the list.
  return rows.length >= MAX_VALUES_PER_CHECK ? [...counts, { organizationId: null, value: TRUNCATED_VALUE, rows: 0 }] : counts
}

/**
 * Values a company's status list doesn't read as one of its statuses (or
 * empty ones). A row with no company (its project is gone) is read against
 * the built-in list.
 */
async function companyStatusDrift(
  db: Db,
  recordType: (typeof RECORD_STATUS_TYPES)[number],
  counts: readonly StatusValueCount[],
  cache: StatusListCache,
): Promise<StatusValueCount[]> {
  const listFor = async (organizationId: string | null): Promise<RecordStatusList> => {
    if (organizationId === null) return defaultRecordStatusList(recordType)
    let lists = cache.get(organizationId)
    if (!lists) {
      lists = loadAllRecordStatusLists(db, organizationId)
      cache.set(organizationId, lists)
    }
    return (await lists).find((list) => list.type === recordType) ?? defaultRecordStatusList(recordType)
  }
  const organizationIds = [...new Set(counts.map((count) => count.organizationId))]
  // Sequential: one company's lists at a time (cached for the run's other checks).
  const lists = new Map<string | null, RecordStatusList>()
  for (const organizationId of organizationIds) lists.set(organizationId, await listFor(organizationId))
  return counts.filter((count) => {
    if (count.value === null || count.value === TRUNCATED_VALUE) return true
    const list = lists.get(count.organizationId)
    return list === undefined || recordStatusExactKey(list, count.value) === null
  })
}

async function checkFindings(db: Db, check: StatusCheck, cache: StatusListCache): Promise<StatusFinding[]> {
  if (check.kind === "not_stored") return []
  const where = { check: check.machine.name, table: getTableName(check.column.table), column: check.column.name }
  if (check.kind === "machine") {
    const counts = await readValueCounts(db, { column: check.column, owner: check.owner, scope: check.scope, allowed: check.machine.states })
    return counts.map((count) => ({ ...where, ...count }))
  }
  const counts = await readValueCounts(db, { column: check.column, owner: check.owner, scope: check.scope })
  const drift = await companyStatusDrift(db, check.recordType, counts, cache)
  return drift.map((count) => ({ ...where, ...count }))
}

/** Every status finding, for every registered check. */
export async function readStatusFindings(db: Db, checks: readonly StatusCheck[]): Promise<StatusFinding[]> {
  const cache: StatusListCache = new Map()
  return inSmallBatches(checks, (check) => checkFindings(db, check, cache))
}

/** The live database's tables and their columns (D1's own tables left out). */
export async function readLiveSchema(db: Db): Promise<ReadonlyMap<string, readonly string[]>> {
  const tableRows = await db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
  const names = tableRows.flatMap((row) => {
    const name = cleanText(field(row, "name"))
    return name && !isInternalTable(name) ? [name] : []
  })
  // One query per 50 tables (chunkD1Values keeps each IN list under D1's bound-parameter limit).
  const columnRows = await inSmallBatches(chunkD1Values(names), (chunk) =>
    db.all(sql`SELECT m.name AS table_name, p.name AS column_name
      FROM sqlite_master m JOIN pragma_table_info(m.name) p
      WHERE m.type = 'table' AND m.name IN (${sql.join(chunk.map((name) => sql`${name}`), sql`, `)})`),
  )
  const tables = new Map<string, string[]>(names.map((name) => [name, []]))
  for (const row of columnRows) {
    const table = cleanText(field(row, "table_name"))
    const column = cleanText(field(row, "column_name"))
    if (table && column) tables.get(table)?.push(column)
  }
  return tables
}
