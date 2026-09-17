import { drizzle } from "drizzle-orm/d1"
import { createRequire } from "node:module"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = {
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireFeaturePermission: vi.fn(),
  relayAgentRequest: vi.fn(),
  jarvisReadCapabilitiesForUser: vi.fn(),
  isDemoUser: vi.fn(),
  revalidatePath: vi.fn(),
}

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permission-enforcement", () => ({
  FeaturePermissionDeniedError: class extends Error {},
  isFeaturePermissionDeniedError: () => false,
  getEffectivePermissionAccessLevel: async () => "edit",
  canFeature: async () => true,
  requireFeaturePermission: mocks.requireFeaturePermission,
}))
vi.mock("@/lib/jarvis/agent-relay", () => ({
  isJarvisAgentBridgeEnabled: () => true,
  relayAgentRequest: mocks.relayAgentRequest,
}))
vi.mock("@/lib/jarvis/read-capabilities", () => ({
  jarvisReadCapabilitiesForUser: mocks.jarvisReadCapabilitiesForUser,
}))
vi.mock("@/lib/demo", () => ({
  DEMO_ORG_ID: "demo-org-meridian",
  DEMO_USER_ID: "demo-user-001",
  DEMO_USER: {},
  isDemoUser: mocks.isDemoUser,
  isDemoOrg: (orgId: string) => orgId === "demo-org-meridian",
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

const {
  createManualOwnerProjectUpdateDraft,
  deleteOwnerProjectUpdateDraft,
  draftOwnerProjectUpdateWithJarvis,
  draftOwnerUpdateFromDailyLogs,
  publishOwnerProjectUpdate,
  recallOwnerProjectUpdate,
  updateOwnerProjectUpdateDraft,
} = await import("@/app/actions/project-field")

type SqliteStatement = Readonly<{
  readonly run: (...values: readonly unknown[]) => { readonly changes: number }
  readonly all: (...values: readonly unknown[]) => readonly unknown[]
  readonly get: (...values: readonly unknown[]) => unknown
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
    const defaultImport =
      imported !== null && typeof imported === "object"
        ? Reflect.get(imported, "default")
        : undefined
    if (isSqliteConstructor(defaultImport)) return new defaultImport(path)
  } catch {
    // Bun uses its built-in SQLite when the native addon is unavailable.
  }
  const bunSqliteSpecifier = "bun:sqlite"
  const imported: unknown = nodeRequire(bunSqliteSpecifier)
  const database =
    imported !== null && typeof imported === "object"
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

function createD1(sqlite: Sqlite) {
  function prepared(
    sqlText: string,
    values: readonly unknown[] = []
  ): {
    readonly bind: (...nextValues: readonly unknown[]) => ReturnType<typeof prepared>
    readonly all: () => Promise<{
      readonly success: true
      readonly results: readonly unknown[]
    }>
    readonly raw: () => Promise<readonly unknown[][]>
  } {
    const query = statement(sqlite, sqlText)
    return {
      bind: (...nextValues) => prepared(sqlText, nextValues),
      async all() {
        return { success: true, results: query.all(...values) }
      },
      async raw() {
        if (query.values) return query.values(...values)
        return query
          .all(...values)
          .map((row) => {
            if (Array.isArray(row)) return row
            if (row !== null && typeof row === "object") return Object.values(row)
            return [row]
          })
      },
    }
  }

  return {
    prepare: (sqlText: string) => prepared(sqlText),
    batch: async (
      statements: readonly ReturnType<typeof prepared>[]
    ): Promise<readonly unknown[]> => {
      return statements.map((item) => item.all())
    },
    exec: async (sqlText: string) => {
      sqlite.exec(sqlText)
      return { count: 0, duration: 0 }
    },
  }
}

const version = {
  expectedRevision: 0,
  expectedUpdatedAt: "2026-07-28T14:20:14.659Z",
}

const draft = {
  ...version,
  title: "Weekly update",
  updateDate: "2026-07-28",
  periodStart: "2026-07-28",
  periodEnd: "2026-07-28",
  summary: "Drywall is moving forward.",
  sourceDailyLogIds: [],
  selectedPhotoIds: [],
  selectedDocumentIds: [],
  completedScheduleItems: [],
  lookAheadScheduleItems: [],
  todos: [],
}

const internalUser = {
  id: "staff-1",
  isActive: true,
  role: "office",
  organizationId: "org-1",
  organizationType: "internal",
}

function createDatabase(): {
  readonly sqlite: Sqlite
  readonly db: ReturnType<typeof drizzle>
} {
  const sqlite = newSqlite(":memory:")
  sqlite.exec(`
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      project_number TEXT
    );
    CREATE TABLE owner_project_updates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      title TEXT NOT NULL,
      update_date TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      channel TEXT NOT NULL,
      source_daily_log_ids TEXT,
      selected_photo_ids TEXT,
      period_start TEXT,
      period_end TEXT,
      schedule_snapshot TEXT,
      published_at TEXT,
      sent_at TEXT,
      recalled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE schedule_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date_calculated TEXT NOT NULL,
      assigned_to TEXT,
      status TEXT NOT NULL,
      percent_complete REAL NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE project_operations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      assignee_name TEXT,
      company_name TEXT,
      due_date TEXT,
      source_record_type TEXT NOT NULL
    );
  `)
  // @ts-expect-error The test adapter implements the D1 methods used by Drizzle.
  return { sqlite, db: drizzle(createD1(sqlite)) }
}

function run(sqlite: Sqlite, sql: string, ...values: readonly unknown[]): void {
  statement(sqlite, sql).run(...values)
}

function get(sqlite: Sqlite, sql: string, ...values: readonly unknown[]): unknown {
  return statement(sqlite, sql).get(...values)
}

function seedDraft(sqlite: Sqlite): void {
  run(sqlite, "INSERT INTO organizations (id, type, is_active) VALUES (?, ?, ?)", "org-1", "internal", 1)
  run(
    sqlite,
    "INSERT INTO projects (id, organization_id, name, project_number) VALUES (?, ?, ?, ?)",
    "project-1",
    "org-1",
    "Project One",
    "P-001"
  )
  run(
    sqlite,
    `INSERT INTO owner_project_updates
       (id, project_id, created_by, title, update_date, summary, status, channel,
        period_start, period_end, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ,
      "update-1",
      "project-1",
      "staff-1",
      "Weekly update",
      "2026-07-28",
      "Drywall is moving forward.",
      "draft",
      "compass",
      "2026-07-28",
      "2026-07-28",
      "2026-07-28T14:00:00.000Z",
      version.expectedUpdatedAt,
      0
  )
}

describe("owner update mutation authorization and fencing", () => {
  let sqlite: Sqlite

  beforeEach(() => {
    vi.clearAllMocks()
    const database = createDatabase()
    sqlite = database.sqlite
    mocks.getDb.mockReturnValue(database.db)
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        DB: "test-db",
        JARVIS_AGENT_BRIDGE_ENABLED: "true",
        JARVIS_BRIDGE_SECRET: "test-secret",
      },
    })
    mocks.requireAuth.mockResolvedValue(internalUser)
    mocks.requireFeaturePermission.mockResolvedValue(undefined)
    mocks.jarvisReadCapabilitiesForUser.mockResolvedValue([])
    mocks.relayAgentRequest.mockResolvedValue({
      success: true,
      content: "A generated summary.",
    })
    mocks.isDemoUser.mockReturnValue(false)
    seedDraft(sqlite)
  })

  it("denies every owner-update mutation sibling to external roles before database access", async () => {
    mocks.requireAuth.mockResolvedValue({
      ...internalUser,
      role: "client",
    })
    mocks.getCloudflareContext.mockImplementation(() => {
      throw new Error("database access reached")
    })
    mocks.requireFeaturePermission.mockClear()

    const results = await Promise.all([
      draftOwnerUpdateFromDailyLogs("project-1", { dailyLogIds: ["log-1"] }),
      createManualOwnerProjectUpdateDraft("project-1", "2026-07-28"),
      deleteOwnerProjectUpdateDraft("project-1", "update-1"),
      draftOwnerProjectUpdateWithJarvis("project-1", "update-1"),
      recallOwnerProjectUpdate("project-1", "update-1"),
    ])

    expect(results).toEqual([
      { success: false, error: "Permission denied: internal staff access is required" },
      { success: false, error: "Permission denied: internal staff access is required" },
      { success: false, error: "Permission denied: internal staff access is required" },
      { success: false, error: "Permission denied: internal staff access is required" },
      { success: false, error: "Permission denied: internal staff access is required" },
    ])
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
  })

  it("denies every owner-update mutation sibling when the internal organization is inactive", async () => {
    run(sqlite, "UPDATE organizations SET is_active = 0")
    mocks.getCloudflareContext.mockClear()
    mocks.requireFeaturePermission.mockClear()

    const results = await Promise.all([
      draftOwnerUpdateFromDailyLogs("project-1", { dailyLogIds: ["log-1"] }),
      createManualOwnerProjectUpdateDraft("project-1", "2026-07-28"),
      deleteOwnerProjectUpdateDraft("project-1", "update-1"),
      draftOwnerProjectUpdateWithJarvis("project-1", "update-1"),
      recallOwnerProjectUpdate("project-1", "update-1"),
    ])

    expect(results).toEqual([
      { success: false, error: "Permission denied: active internal organization is required" },
      { success: false, error: "Permission denied: active internal organization is required" },
      { success: false, error: "Permission denied: active internal organization is required" },
      { success: false, error: "Permission denied: active internal organization is required" },
      { success: false, error: "Permission denied: active internal organization is required" },
    ])
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
  })

  it("keeps every owner-update mutation sibling scoped to the requested project organization", async () => {
    run(
      sqlite,
      "INSERT INTO organizations (id, type, is_active) VALUES (?, ?, ?)",
      "org-2",
      "internal",
      1
    )
    run(
      sqlite,
      "INSERT INTO projects (id, organization_id, name, project_number) VALUES (?, ?, ?, ?)",
      "project-2",
      "org-2",
      "Project Two",
      "P-002"
    )

    const results = await Promise.all([
      draftOwnerUpdateFromDailyLogs("project-2", { dailyLogIds: ["log-1"] }),
      createManualOwnerProjectUpdateDraft("project-2", "2026-07-28"),
      deleteOwnerProjectUpdateDraft("project-2", "update-1"),
      draftOwnerProjectUpdateWithJarvis("project-2", "update-1"),
      recallOwnerProjectUpdate("project-2", "update-1"),
    ])

    expect(results).toEqual([
      { success: false, error: "Project not found" },
      { success: false, error: "Project not found" },
      { success: false, error: "Project not found" },
      { success: false, error: "Project not found" },
      { success: false, error: "Project not found" },
    ])
    expect(mocks.relayAgentRequest).not.toHaveBeenCalled()
  })

  it("denies an external role even when a feature override would allow editing", async () => {
    mocks.requireAuth.mockResolvedValue({
      ...internalUser,
      role: "client",
    })

    const result = await updateOwnerProjectUpdateDraft(
      "project-1",
      "update-1",
      draft
    )

    expect(result).toEqual({
      success: false,
      error: "Permission denied: internal staff access is required",
    })
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
  })

  it("denies an inactive internal user before opening the database", async () => {
    mocks.requireAuth.mockResolvedValue({
      ...internalUser,
      isActive: false,
    })

    const result = await updateOwnerProjectUpdateDraft(
      "project-1",
      "update-1",
      draft
    )

    expect(result).toEqual({
      success: false,
      error: "Permission denied: internal staff access is required",
    })
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
  })

  it("denies an inactive internal organization before feature permission", async () => {
    run(sqlite, "UPDATE organizations SET is_active = 0")

    const result = await updateOwnerProjectUpdateDraft(
      "project-1",
      "update-1",
      draft
    )

    expect(result).toEqual({
      success: false,
      error: "Permission denied: active internal organization is required",
    })
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
  })

  it("allows only one of two stale saves with the same revision and timestamp", async () => {
    const results = await Promise.all([
      updateOwnerProjectUpdateDraft("project-1", "update-1", draft),
      updateOwnerProjectUpdateDraft("project-1", "update-1", draft),
    ])

    expect(results.filter((result) => result.success)).toHaveLength(1)
    expect(results.filter((result) => !result.success)).toEqual([
      {
        success: false,
        error:
          "This owner update changed while you were saving. Refresh and review the latest version.",
      },
    ])
    expect(
      get(
        sqlite,
        "SELECT title, revision, updated_at, status FROM owner_project_updates WHERE id = ?",
        "update-1"
      )
    ).toEqual({
      title: "Weekly update",
      revision: 1,
      updated_at: expect.any(String),
      status: "draft",
    })
  })

  it("rejects a timestamp that is stale even when the revision is current", async () => {
    const saved = await updateOwnerProjectUpdateDraft(
      "project-1",
      "update-1",
      draft
    )
    expect(saved.success).toBe(true)

    const result = await updateOwnerProjectUpdateDraft("project-1", "update-1", {
      ...draft,
      expectedRevision: 1,
      expectedUpdatedAt: version.expectedUpdatedAt,
    })

    expect(result).toEqual({
      success: false,
      error:
        "This owner update changed while you were saving. Refresh and review the latest version.",
    })
  })

  it("rejects a stale publish at the final status and revision CAS", async () => {
    const saved = await updateOwnerProjectUpdateDraft(
      "project-1",
      "update-1",
      draft
    )
    expect(saved.success).toBe(true)

    const result = await publishOwnerProjectUpdate(
      "project-1",
      "update-1",
      { revision: version.expectedRevision, updatedAt: version.expectedUpdatedAt }
    )

    expect(result).toEqual({
      success: false,
      error:
        "This owner update changed while you were publishing. Refresh and review the latest version.",
    })
    expect(
      get(
        sqlite,
        "SELECT status, revision FROM owner_project_updates WHERE id = ?",
        "update-1"
      )
    ).toEqual({ status: "draft", revision: 1 })
  })

  it("does not let a stale Jarvis response overwrite a newer user save", async () => {
    let releaseRelay:
      | ((value: { readonly success: true; readonly content: string }) => void)
      | undefined
    mocks.relayAgentRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRelay = resolve
        })
    )

    const jarvisPromise = draftOwnerProjectUpdateWithJarvis("project-1", "update-1")
    await vi.waitFor(() => expect(mocks.relayAgentRequest).toHaveBeenCalled())

    run(
      sqlite,
      "UPDATE owner_project_updates SET summary = ?, revision = ?, updated_at = ? WHERE id = ?",
      "Newer user save",
      1,
      "2026-07-28T14:30:00.000Z",
      "update-1"
    )
    releaseRelay?.({ success: true, content: "Stale Jarvis summary" })

    const result = await jarvisPromise
    expect(result).toEqual({
      success: false,
      error:
        "This owner update changed while Jarvis was drafting. Refresh and review the latest version.",
    })
    expect(
      get(
        sqlite,
        "SELECT summary, revision FROM owner_project_updates WHERE id = ?",
        "update-1"
      )
    ).toEqual({ summary: "Newer user save", revision: 1 })
  })

  it("does not let a stale Jarvis response overwrite a newly published update", async () => {
    let releaseRelay:
      | ((value: { readonly success: true; readonly content: string }) => void)
      | undefined
    mocks.relayAgentRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRelay = resolve
        })
    )

    const jarvisPromise = draftOwnerProjectUpdateWithJarvis("project-1", "update-1")
    await vi.waitFor(() => expect(mocks.relayAgentRequest).toHaveBeenCalled())

    run(
      sqlite,
      "UPDATE owner_project_updates SET summary = ?, status = ?, revision = ?, updated_at = ? WHERE id = ?",
      "Published user summary",
      "published",
      1,
      "2026-07-28T14:31:00.000Z",
      "update-1"
    )
    releaseRelay?.({ success: true, content: "Stale Jarvis summary" })

    const result = await jarvisPromise
    expect(result).toEqual({
      success: false,
      error:
        "This owner update changed while Jarvis was drafting. Refresh and review the latest version.",
    })
    expect(
      get(
        sqlite,
        "SELECT summary, status, revision FROM owner_project_updates WHERE id = ?",
        "update-1"
      )
    ).toEqual({
      summary: "Published user summary",
      status: "published",
      revision: 1,
    })
  })
})
