import { createRequire } from "node:module"
import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { projectChangeOrders, projects } from "@/db/schema"
import {
  buildertrendImportObservations,
  buildertrendSourceRecords,
} from "@/db/schema-buildertrend"

const mocks = vi.hoisted(() => ({
  assertProjectAccess: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  isDemoUser: vi.fn(),
  isInternalStaffRole: vi.fn(),
  requireAuth: vi.fn(),
  requireFeaturePermission: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/demo", () => ({ isDemoUser: mocks.isDemoUser }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/permission-enforcement", () => ({ requireFeaturePermission: mocks.requireFeaturePermission }))
vi.mock("@/lib/user-roles", () => ({ isInternalStaffRole: mocks.isInternalStaffRole }))

import { getProjectArchivedBuildertrendChangeOrders } from "@/app/actions/project-archived-change-orders"

type SqliteStatement = Readonly<{
  readonly run: (...values: readonly unknown[]) => { readonly changes: number }
  readonly all: (...values: readonly unknown[]) => readonly unknown[]
  readonly values?: (...values: readonly unknown[]) => readonly unknown[][]
  readonly raw?: () => SqliteStatement
}>

type Sqlite = Readonly<{
  readonly exec: (sql: string) => void
  readonly close: () => void
  readonly prepare?: (sql: string) => SqliteStatement
  readonly query?: (sql: string) => SqliteStatement
}>

type SqliteConstructor = new (file: string) => Sqlite

function isSqliteConstructor(value: unknown): value is SqliteConstructor {
  return typeof value === "function"
}

const nodeRequire = createRequire(import.meta.url)

function newSqlite(path: string): Sqlite {
  try {
    const imported: unknown = nodeRequire("better-sqlite3")
    if (isSqliteConstructor(imported)) return new imported(path)
    const defaultImport = imported !== null && typeof imported === "object"
      ? Reflect.get(imported, "default")
      : undefined
    if (isSqliteConstructor(defaultImport)) return new defaultImport(path)
  } catch { /* Bun provides the fallback adapter in its test runtime. */ }
  const imported: unknown = nodeRequire("bun:sqlite")
  const database = imported !== null && typeof imported === "object"
    ? Reflect.get(imported, "Database")
    : undefined
  if (isSqliteConstructor(database)) return new database(path)
  throw new Error("No SQLite test adapter available")
}

function statement(sqlite: Sqlite, sql: string): SqliteStatement {
  if (sqlite.prepare) return sqlite.prepare(sql)
  if (sqlite.query) return sqlite.query(sql)
  throw new Error("SQLite adapter has no statement method")
}

type D1Statement = Readonly<{
  readonly __query: string
  readonly bind: (...values: readonly unknown[]) => D1Statement
  readonly all: () => Promise<Readonly<{ readonly success: true; readonly results: readonly unknown[] }>>
  readonly raw: () => Promise<readonly unknown[][]>
}>

function createD1(sqlite: Sqlite, queries: string[]) {
  function prepared(query: string, values: readonly unknown[] = []): D1Statement {
    const sql = statement(sqlite, query)
    return {
      __query: query,
      bind: (...nextValues) => prepared(query, nextValues),
      async all() {
        queries.push(query)
        return { success: true, results: sql.all(...values) }
      },
      async raw() {
        queries.push(query)
        if (sql.values) return sql.values(...values)
        if (sql.raw) return sql.raw().all(...values).map((row) => Array.isArray(row) ? row : [row])
        return sql.all(...values).map((row) => row !== null && typeof row === "object" ? Object.values(row) : [row])
      },
    }
  }
  return {
    prepare(query: string): D1Statement { return prepared(query) },
    async batch(statements: readonly D1Statement[]) {
      return Promise.all(statements.map(async (item) => item.all()))
    },
  }
}

type TestUser = Readonly<{
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly role: string
  readonly organizationId: string | null
  readonly organizationType: string
  readonly isActive: boolean
}>

const projectId = "project-archive"
const organizationId = "org-archive"
const jobId = "35400494"
const sourceId = "10190380"
const sourceKey = `job:${jobId}:change_order:${sourceId}`
const sourceUrl = `https://buildertrend.net/app/ChangeOrders/${sourceId}/${jobId}/Details`
const archiveFileId = "1-iCVyTmRvdG18G46MKPhTX6et7GNhdpg"
const archiveUrl = `https://drive.google.com/file/d/${archiveFileId}/view?usp=drivesdk`
const sourceRowId = "stage-change-order"
const actor: TestUser = {
  id: "staff-archive",
  email: "staff@example.test",
  displayName: "Archive Reviewer",
  role: "admin",
  organizationId,
  organizationType: "internal",
  isActive: true,
}

type TestState = Readonly<{
  readonly sqlite: Sqlite
  readonly d1: unknown
  readonly db: ReturnType<typeof drizzle>
  readonly queries: string[]
}>

function createSchema(sqlite: Sqlite): void {
  sqlite.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, organization_id TEXT, buildertrend_project_id TEXT);
    CREATE TABLE project_change_orders (id TEXT PRIMARY KEY, project_id TEXT, source_type TEXT, source_record_id TEXT);
    CREATE TABLE buildertrend_staging_records (
      id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, requested_project_id TEXT,
      source_key TEXT, source_record_type TEXT, buildertrend_job_id TEXT,
      buildertrend_record_id TEXT, buildertrend_record_number TEXT, buildertrend_url TEXT,
      title TEXT, source_status TEXT, client_name TEXT, raw_payload_json TEXT,
      verified_archive_drive_file_id TEXT, verified_archive_drive_url TEXT,
      review_status TEXT, promotion_status TEXT, updated_at TEXT
    );
    CREATE TABLE buildertrend_staging_observations (
      id TEXT PRIMARY KEY, organization_id TEXT, entity_kind TEXT, entity_key TEXT,
      entity_id TEXT, observed_payload_json TEXT, observed_at TEXT
    );
  `)
}

function payload(): string {
  return JSON.stringify({
    schemaVersion: 1,
    sourceArchiveSha256: "e4a4559ab1c1848312d35cb9cbcad166e4d0ddd0bce0a117acadf5b47a7802fa",
    driveFileId: archiveFileId,
    sourceKey,
    sourceStatus: "Approved (list and detail)",
    sourceRecord: {
      sourceId,
      number: "O-170-0008",
      title: "July 2026 Variances",
      sourceUrl,
      listStatus: "Approved",
      detailStatus: "Approved",
      sourceScope: "Synthetic captured variance scope.",
      requiredApprovers: ["Project owner label only"],
      lines: [["33 36 00 - Utility Septic Tanks", "$24.85", "1.0000", "$24.85"]],
    },
    sourceLineIdentity: {
      buildertrendChangeOrderId: sourceId,
      number: "O-170-0008",
      url: sourceUrl,
      rows: [{
        displayOrder: 1,
        sourceLineIdFromRowKey: "19874702",
        displayedTitle: "--",
        displayedCostCode: "33 36 00 - Utility Septic Tanks",
        displayedClientPrice: "$24.85",
      }],
    },
    expandedActivity: {
      buildertrendChangeOrderId: sourceId,
      buildertrendJobId: jobId,
      sourceUrl,
      events: [{ displayOrder: 1, kind: "Approved", actor: "Approval Actor", displayedAt: "Source display time", changes: [] }],
    },
    decision: { sourcePurpose: "variance", requester: "unknown", budgetMutationApplied: false },
    stagingRawPayload: {
      archive: { driveFileId: archiveFileId, driveUrl: archiveUrl },
      contractSemantics: {
        purpose: "variance",
        requesterEstablishedBySource: false,
        approvalActorIsRequester: false,
      },
    },
  })
}

function createState(): TestState {
  const sqlite = newSqlite(":memory:")
  createSchema(sqlite)
  statement(sqlite, "INSERT INTO projects VALUES (?, ?, ?)").run(projectId, organizationId, jobId)
  const queries: string[] = []
  const d1 = createD1(sqlite, queries)
  // @ts-expect-error This focused adapter implements only the D1 methods exercised here.
  const db = drizzle(d1, { schema: { projects, projectChangeOrders, buildertrendSourceRecords, buildertrendImportObservations } })
  return { sqlite, d1, db, queries }
}

function addArchive(state: TestState, observedPayload: string | null = payload()): void {
  statement(state.sqlite, "INSERT INTO buildertrend_staging_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    sourceRowId, organizationId, projectId, projectId, sourceKey, "change_order", jobId,
    sourceId, "O-170-0008", sourceUrl, "July 2026 Variances", "Approved (list and detail)",
    "Project owner label only", "{}", archiveFileId, archiveUrl, "verified", "archive_only", "2026-09-06T16:36:00Z"
  )
  if (observedPayload === null) return
  statement(state.sqlite, "INSERT INTO buildertrend_staging_observations VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "observation-change-order", organizationId, "record", sourceKey, sourceRowId,
    observedPayload, "2026-09-06T16:36:00Z"
  )
}

function configure(state: TestState, user: TestUser = actor): void {
  mocks.requireAuth.mockResolvedValue(user)
  mocks.isDemoUser.mockReturnValue(false)
  mocks.isInternalStaffRole.mockImplementation((role: unknown) => role === "admin")
  mocks.requireFeaturePermission.mockResolvedValue(undefined)
  mocks.assertProjectAccess.mockResolvedValue({ id: projectId, organizationId })
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: state.d1 } })
  mocks.getDb.mockReturnValue(state.db)
}

describe("archived Buildertrend change-order action", () => {
  let state: TestState

  beforeEach(() => {
    state = createState()
    configure(state)
  })

  afterEach(() => {
    state.sqlite.close()
    vi.clearAllMocks()
  })

  it("returns source evidence to internal staff using read-only queries", async () => {
    addArchive(state)
    const result = await getProjectArchivedBuildertrendChangeOrders(projectId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.records).toHaveLength(1)
    expect(result.holds).toEqual([])
    expect(result.records[0]).toMatchObject({
      requester: "Unknown — not established by source",
      approvalActor: "Approval Actor",
      ownerRequested: false,
      budgetActive: false,
      displayStatus: "Approved · Buildertrend",
      purpose: "Variance",
    })
    expect(state.queries.length).toBeGreaterThan(0)
    expect(state.queries.every((query) => /^select\b/i.test(query.trim()))).toBe(true)
    expect(state.queries.join(" ")).not.toMatch(/budget|estimate|invoice/i)
  })

  it("denies external and owner-role users before opening the database", async () => {
    for (const user of [
      { ...actor, organizationType: "external" },
      { ...actor, role: "client" },
    ]) {
      configure(state, user)
      const result = await getProjectArchivedBuildertrendChangeOrders(projectId)
      expect(result.success).toBe(false)
      expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
      vi.clearAllMocks()
    }
  })

  it("deduplicates an archive row already represented by a native Buildertrend record", async () => {
    addArchive(state)
    statement(state.sqlite, "INSERT INTO project_change_orders VALUES (?, ?, ?, ?)").run(
      "native-change-order", projectId, "buildertrend_import", sourceId
    )
    const result = await getProjectArchivedBuildertrendChangeOrders(projectId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.records).toEqual([])
    expect(result.holds).toEqual([])
  })

  it("withholds a row without matching immutable evidence", async () => {
    addArchive(state, null)
    const result = await getProjectArchivedBuildertrendChangeOrders(projectId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.records).toEqual([])
    expect(result.holds).toEqual([{
      sourceRecordId: sourceRowId,
      reason: "Matching immutable source evidence is not available.",
    }])
  })
})
