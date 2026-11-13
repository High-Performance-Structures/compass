/**
 * Production drift detector: the pure part (issue #1329). No database or
 * network access. ./reads.ts gathers the counts and the live schema, these
 * rules turn them into a report, and ./notices.ts tells company admins.
 *
 * Two kinds of drift:
 *   - status drift: rows whose status column holds a value its declared
 *     state machine (./status-checks.ts) does not allow;
 *   - schema drift: tables or columns the live database has that the Drizzle
 *     schema does not declare, and the reverse. Leftovers the migrations made
 *     on purpose (src/db/known-schema-differences.ts) are listed as known.
 */
import type { KnownSchemaDifference } from "@/db/known-schema-differences"

/** One status value a check found, counted per company (null: no company, shown to every company). */
export type StatusValueCount = {
  readonly organizationId: string | null
  /** The stored value; null for an empty status. */
  readonly value: string | null
  readonly rows: number
}

export type StatusFinding = StatusValueCount & {
  /** The machine's name ("change order"). */
  readonly check: string
  readonly table: string
  readonly column: string
}

export type SchemaDrift = {
  /** Tables the database has that the schema doesn't declare. */
  readonly extraTables: readonly string[]
  /** "table.column" the database has that the schema doesn't declare. */
  readonly extraColumns: readonly string[]
  /** Declared tables the database doesn't have. */
  readonly missingTables: readonly string[]
  /** Declared "table.column" the database doesn't have. */
  readonly missingColumns: readonly string[]
  /** Known migration-only leftovers that are present (not drift). */
  readonly known: readonly string[]
}

export type DataHealthReport = {
  readonly checkedAt: string
  /** How many status columns were checked. */
  readonly statusChecks: number
  readonly statusFindings: readonly StatusFinding[]
  readonly schema: SchemaDrift
}

/** Tables D1 and wrangler keep for themselves; never compared. */
export function isInternalTable(name: string): boolean {
  return name.startsWith("sqlite_") || name.startsWith("_cf_") || name === "d1_migrations"
}

/** Compares the declared schema with the live database. */
export function schemaDrift(
  declared: ReadonlyMap<string, readonly string[]>,
  live: ReadonlyMap<string, readonly string[]>,
  knownDifferences: readonly KnownSchemaDifference[],
): SchemaDrift {
  const knownTables = new Set(knownDifferences.flatMap((item) => (item.kind === "table" ? [item.table] : [])))
  const knownColumns = new Set(knownDifferences.flatMap((item) => (item.kind === "column" ? [`${item.table}.${item.column}`] : [])))
  const extraTables: string[] = []
  const extraColumns: string[] = []
  const missingTables: string[] = []
  const missingColumns: string[] = []
  const known: string[] = []

  for (const [table, columns] of live) {
    if (isInternalTable(table)) continue
    const declaredColumns = declared.get(table)
    if (!declaredColumns) {
      if (knownTables.has(table)) known.push(table)
      else extraTables.push(table)
      continue
    }
    for (const column of columns) {
      if (declaredColumns.includes(column)) continue
      const name = `${table}.${column}`
      if (knownColumns.has(name)) known.push(name)
      else extraColumns.push(name)
    }
    for (const column of declaredColumns) {
      if (!columns.includes(column)) missingColumns.push(`${table}.${column}`)
    }
  }
  for (const table of declared.keys()) {
    if (!live.has(table)) missingTables.push(table)
  }
  return {
    extraTables: extraTables.sort(),
    extraColumns: extraColumns.sort(),
    missingTables: missingTables.sort(),
    missingColumns: missingColumns.sort(),
    known: known.sort(),
  }
}

function schemaDriftCount(schema: SchemaDrift): number {
  return schema.extraTables.length + schema.extraColumns.length + schema.missingTables.length + schema.missingColumns.length
}

/** True when the report found no status or schema drift. */
export function isHealthy(report: DataHealthReport): boolean {
  return report.statusFindings.length === 0 && schemaDriftCount(report.schema) === 0
}

const NO_SCHEMA_DRIFT: SchemaDrift = { extraTables: [], extraColumns: [], missingTables: [], missingColumns: [], known: [] }

/**
 * Whether a company sees deployment-wide drift (the schema, and rows that
 * belong to no company): the operating company named by
 * DATA_HEALTH_OPERATOR_ORGANIZATION_ID, or every company when none is named
 * (a deployment run by a single company).
 */
export function seesDeploymentDrift(organizationId: string, operatorOrganizationId: string | null): boolean {
  return operatorOrganizationId === null || operatorOrganizationId === organizationId
}

/**
 * The part of the report one company sees: its own status findings, plus
 * the deployment-wide ones (rows with no company, and the schema) when it
 * sees those (seesDeploymentDrift).
 */
export function reportForOrganization(report: DataHealthReport, organizationId: string, includeDeployment = true): DataHealthReport {
  return {
    ...report,
    statusFindings: report.statusFindings.filter(
      (finding) => finding.organizationId === organizationId || (includeDeployment && finding.organizationId === null),
    ),
    schema: includeDeployment ? report.schema : NO_SCHEMA_DRIFT,
  }
}

/** The same finding for every company, merged: for the deployment-wide summary. */
export function findingsByValue(findings: readonly StatusFinding[]): readonly StatusFinding[] {
  const merged = new Map<string, StatusFinding>()
  for (const finding of findings) {
    const key = `${finding.table}\u0000${finding.column}\u0000${finding.value ?? "\u0001"}`
    const existing = merged.get(key)
    merged.set(key, existing ? { ...existing, rows: existing.rows + finding.rows, organizationId: null } : finding)
  }
  return [...merged.values()].sort(
    (a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column) || (a.value ?? "").localeCompare(b.value ?? ""),
  )
}

/** What a status finding says, without its count ("project_operations.status = \"incomplete\""). */
function findingKey(finding: StatusFinding): string {
  return `${finding.table}.${finding.column} = ${finding.value === null ? "(empty)" : JSON.stringify(finding.value)}`
}

/** cyrb53: a short, stable, non-cryptographic hash. */
function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** The fingerprint of a clean report. */
export const HEALTHY_FINGERPRINT = "healthy"

/**
 * Which drift a report found, ignoring row counts: a notice goes out only when
 * this changes, so a count that grows each day doesn't notify each day.
 */
export function driftFingerprint(report: DataHealthReport): string {
  if (isHealthy(report)) return HEALTHY_FINGERPRINT
  const items = [
    ...findingsByValue(report.statusFindings).map(findingKey),
    ...report.schema.extraTables.map((table) => `+table ${table}`),
    ...report.schema.extraColumns.map((column) => `+column ${column}`),
    ...report.schema.missingTables.map((table) => `-table ${table}`),
    ...report.schema.missingColumns.map((column) => `-column ${column}`),
  ].sort()
  return `drift:${hash(items.join("\n"))}`
}

/**
 * Whether a company is told: only when its drift differs from the last notice
 * (a clean report after drift is a change too). A company that never had
 * drift hears nothing.
 */
export function shouldNotify(previousFingerprint: string | null, fingerprint: string): boolean {
  if (previousFingerprint === fingerprint) return false
  return !(previousFingerprint === null && fingerprint === HEALTHY_FINGERPRINT)
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

const NOTICE_LINES = 8

/** The notice an admin gets: a short title and a body listing the first few problems. */
export function driftNotice(report: DataHealthReport): { readonly title: string; readonly body: string } {
  if (isHealthy(report)) {
    return {
      title: "Data health: no drift found",
      body: "The daily data health check found every status value and every table and column as Compass declares them. The earlier drift is gone.",
    }
  }
  const findings = findingsByValue(report.statusFindings)
  const schemaCount = schemaDriftCount(report.schema)
  const lines = [
    ...findings.map((finding) => `${findingKey(finding)} (${plural(finding.rows, "row")}, not allowed by the ${finding.check} statuses)`),
    ...report.schema.extraTables.map((table) => `Table ${table} is in the database but not in the Compass schema`),
    ...report.schema.extraColumns.map((column) => `Column ${column} is in the database but not in the Compass schema`),
    ...report.schema.missingTables.map((table) => `Table ${table} is in the Compass schema but missing from the database`),
    ...report.schema.missingColumns.map((column) => `Column ${column} is in the Compass schema but missing from the database`),
  ]
  const shown = lines.slice(0, NOTICE_LINES)
  const more = lines.length - shown.length
  const parts = [
    findings.length > 0 ? plural(findings.length, "unexpected status value") : null,
    schemaCount > 0 ? plural(schemaCount, "schema difference") : null,
  ].filter((part): part is string => part !== null)
  return {
    title: `Data health: ${parts.join(" and ")}`,
    body: [
      "The daily data health check (read-only) found:",
      ...shown.map((line) => `- ${line}`),
      ...(more > 0 ? [`- and ${more} more`] : []),
      "Nothing was changed. Open Settings › Workflows › Data health to see the full report.",
    ].join("\n"),
  }
}
