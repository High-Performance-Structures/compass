import { drizzle } from "drizzle-orm/d1"
import { createRequire } from "node:module"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  projectAudiencePhotoUrl,
} from "@/lib/photo-sources"
import {
  ownerUpdateExternalDocument,
  ownerUpdateExternalPhoto,
} from "@/lib/owner-updates/external-projection"

vi.mock("server-only", () => ({}))

const mocks = {
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireFeaturePermission: vi.fn(),
  generateOrganizationText: vi.fn(),
  relayAgentRequest: vi.fn(),
  jarvisReadCapabilitiesForUser: vi.fn(),
  isDemoUser: vi.fn(),
  revalidatePath: vi.fn(),
  recordActivityEvent: vi.fn(),
  announceOwnerUpdatePublished: vi.fn(),
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
vi.mock("@/lib/agent/one-shot", () => ({
  generateOrganizationText: mocks.generateOrganizationText,
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
vi.mock("@/lib/activity-log", () => ({
  recordActivityEvent: mocks.recordActivityEvent,
}))
vi.mock("@/lib/owner-updates/publish-notice", () => ({
  announceOwnerUpdatePublished: mocks.announceOwnerUpdatePublished,
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

const {
  createManualOwnerProjectUpdateDraft,
  deleteOwnerProjectUpdateDraft,
  draftOwnerProjectUpdateWithJarvis,
  draftOwnerUpdateFromDailyLogs,
  getProjectFieldSummary,
  getProjectOwnerUpdates,
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

const D1_MAX_BOUND_VARIABLES = 100

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
 readonly run: () => Promise<{ readonly success: true; readonly meta: unknown }>
 readonly all: () => Promise<{
      readonly success: true
      readonly results: readonly unknown[]
    }>
    readonly raw: () => Promise<readonly unknown[][]>
  } {
    const query = statement(sqlite, sqlText)
    return {
      bind: (...nextValues) => prepared(sqlText, nextValues),
      async run() {
        if (values.length > D1_MAX_BOUND_VARIABLES) {
          throw new Error("D1 bound-variable limit exceeded")
        }
        return { success: true, meta: query.run(...values) }
      },
      async all() {
        if (values.length > D1_MAX_BOUND_VARIABLES) {
          throw new Error("D1 bound-variable limit exceeded")
        }
        return { success: true, results: query.all(...values) }
      },
      async raw() {
        if (values.length > D1_MAX_BOUND_VARIABLES) {
          throw new Error("D1 bound-variable limit exceeded")
        }
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
      return Promise.all(statements.map((item) => item.all()))
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

const mutationVersion = {
  revision: version.expectedRevision,
  updatedAt: version.expectedUpdatedAt,
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
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      display_name TEXT
    );
    CREATE TABLE project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL
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
      recalled_by TEXT,
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
    CREATE TABLE daily_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      author_id TEXT,
      source_system TEXT NOT NULL DEFAULT 'compass',
      log_date TEXT NOT NULL,
      work_completed TEXT NOT NULL DEFAULT '',
      review_status TEXT NOT NULL DEFAULT 'draft',
      is_client_visible INTEGER NOT NULL DEFAULT 0,
      tags TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-07-28T12:00:00.000Z'
    );
    CREATE TABLE daily_log_photos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      daily_log_id TEXT,
      captured_at TEXT,
      source_system TEXT NOT NULL DEFAULT 'compass',
      file_name TEXT NOT NULL DEFAULT 'attachment',
      mime_type TEXT,
      drive_file_id TEXT,
      drive_url TEXT,
      thumbnail_url TEXT,
      caption TEXT,
      review_status TEXT NOT NULL,
      owner_visible INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '2026-07-28T12:00:00.000Z'
    );
    CREATE TABLE daily_log_photo_aliases (
      source_photo_id TEXT PRIMARY KEY,
      canonical_photo_id TEXT NOT NULL,
      project_id TEXT NOT NULL
    );
    CREATE TABLE project_external_links (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      system TEXT NOT NULL,
      label TEXT NOT NULL,
      external_url TEXT,
      metadata TEXT
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
  run(sqlite, "INSERT INTO organizations (id, type, is_active) VALUES (?, ?, ?)", "org-client", "client", 1)
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
  run(
    sqlite,
    "INSERT INTO project_members (id, project_id, user_id, role) VALUES (?, ?, ?, ?)",
    "membership-1",
    "project-1",
    "client-1",
    "owner"
  )
}

function seedExternalOwnerSummary(sqlite: Sqlite): void {
  run(
    sqlite,
    "INSERT INTO projects (id, organization_id, name, project_number) VALUES (?, ?, ?, ?)",
    "project-client",
    "org-client",
    "Client Project",
    "C-001"
  )
  run(
    sqlite,
    "INSERT INTO project_members (id, project_id, user_id, role) VALUES (?, ?, ?, ?)",
    "membership-client-owner",
    "project-client",
    "owner-1",
    "owner"
  )
  run(
    sqlite,
    "INSERT INTO users (id, email, first_name, last_name, display_name) VALUES (?, ?, ?, ?, ?)",
    "author-1",
    "author@example.com",
    "Public",
    "Author",
    "Public Author"
  )
  run(
    sqlite,
    `INSERT INTO owner_project_updates
       (id, project_id, created_by, title, update_date, summary, status, channel,
        period_start, period_end, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "client-draft",
    "project-client",
    "staff-1",
    "Private draft",
    "2026-07-29",
    "Private summary",
    "draft",
    "compass",
    "2026-07-29",
    "2026-07-29",
    "2026-07-29T14:00:00.000Z",
    "2026-07-29T14:00:00.000Z",
    0
  )
  run(
    sqlite,
    `INSERT INTO owner_project_updates
       (id, project_id, created_by, title, update_date, summary, status, channel,
        period_start, period_end, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "client-published",
    "project-client",
    "staff-1",
    "Published update",
    "2026-07-28",
    "Public summary",
    "published",
    "compass",
    "2026-07-28",
    "2026-07-28",
    "2026-07-28T14:00:00.000Z",
    "2026-07-28T14:00:00.000Z",
    0
  )
  run(
    sqlite,
    `INSERT INTO daily_logs
       (id, project_id, author_id, source_system, log_date, work_completed,
        review_status, is_client_visible, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "client-hidden-log",
    "project-client",
    "author-1",
    "private-import",
    "2026-07-29",
    "Private work",
    "draft",
    0,
    "private",
    "2026-07-29T12:00:00.000Z"
  )
  run(
    sqlite,
    `INSERT INTO daily_logs
       (id, project_id, author_id, source_system, log_date, work_completed,
        review_status, is_client_visible, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "client-visible-log",
    "project-client",
    "author-1",
    "compass",
    "2026-07-28",
    "Published work",
    "approved",
    1,
    null,
    "2026-07-28T12:00:00.000Z"
  )
  run(
    sqlite,
    `INSERT INTO daily_log_photos
       (id, project_id, daily_log_id, captured_at, source_system, file_name,
        mime_type, drive_file_id, drive_url, thumbnail_url, caption,
        review_status, owner_visible, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "client-hidden-photo",
    "project-client",
    "client-hidden-log",
    "2026-07-29T12:00:00.000Z",
    "private-import",
    "private.jpg",
    "image/jpeg",
    "private-drive-id",
    "https://drive.google.com/private",
    "https://drive.google.com/private-thumb",
    "Private photo",
    "approved",
    0,
    "2026-07-29T12:00:00.000Z",
    "2026-07-29T12:00:00.000Z"
  )
  run(
    sqlite,
    `INSERT INTO daily_log_photos
       (id, project_id, daily_log_id, captured_at, source_system, file_name,
        mime_type, drive_file_id, drive_url, thumbnail_url, caption,
        review_status, owner_visible, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "client-visible-photo",
    "project-client",
    "client-visible-log",
    "2026-07-28T12:00:00.000Z",
    "compass",
    "visible.jpg",
    "image/jpeg",
    "visible-drive-id",
    "https://drive.google.com/visible",
    "https://drive.google.com/visible-thumb",
    "Visible photo",
    "approved",
    1,
    "2026-07-28T12:00:00.000Z",
    "2026-07-28T12:00:00.000Z"
  )
  run(
    sqlite,
    "INSERT INTO project_external_links (id, project_id, system, label, external_url, metadata) VALUES (?, ?, ?, ?, ?, ?)",
    "client-review-folder",
    "project-client",
    "google_buildertrend_review_photos",
    "Private review folder",
    "https://drive.google.com/folder/private",
    '{"photoCount":2}'
  )
}

function seedLargeAttachmentSelection(sqlite: Sqlite): {
  readonly photoIds: readonly string[]
  readonly documentIds: readonly string[]
} {
  const photoIds = Array.from({ length: 121 }, (_, index) => `photo-${index}`)
  const documentIds = Array.from(
    { length: 29 },
    (_, index) => `document-${index}`
  )
  for (const id of [...photoIds, ...documentIds]) {
    const isPhoto = photoIds.includes(id)
    run(
      sqlite,
      `INSERT INTO daily_log_photos
         (id, project_id, daily_log_id, captured_at, source_system, file_name,
          mime_type, thumbnail_url, review_status, owner_visible, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      "project-1",
      null,
      "2026-07-28T12:00:00.000Z",
      "compass",
      `${id}.${isPhoto ? "jpg" : "pdf"}`,
      isPhoto ? "image/jpeg" : "application/pdf",
      isPhoto ? `https://example.test/${id}` : null,
      "pending",
      0,
      version.expectedUpdatedAt
    )
  }
  return { photoIds, documentIds }
}

async function waitForRelayCall(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (mocks.generateOrganizationText.mock.calls.length > 0) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

async function settledDenial(
  operation: Promise<unknown>
): Promise<unknown> {
  try {
    return await operation
  } catch (error) {
    return {
      thrown: error instanceof Error ? error.message : "Unknown error",
    }
  }
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
    mocks.generateOrganizationText.mockResolvedValue({
      success: true,
      text: "A generated summary.",
    })
    mocks.isDemoUser.mockReturnValue(false)
    seedDraft(sqlite)
  })

  it("applies the owner visibility scope in the list query for external readers", async () => {
    seedExternalOwnerSummary(sqlite)
    mocks.requireAuth.mockResolvedValue({
      ...internalUser,
      id: "owner-1",
      role: "client",
      organizationId: "org-client",
      organizationType: "client",
    })

    const updates = await getProjectOwnerUpdates("project-client")

    expect(updates.map((update) => update.id)).toEqual(["client-published"])
  })

  it("does not let a foreign organization membership authorize owner updates", async () => {
    run(
      sqlite,
      "INSERT INTO owner_project_updates (id, project_id, created_by, title, update_date, summary, status, channel, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "foreign-published",
      "project-1",
      "staff-1",
      "Foreign project update",
      "2026-07-29",
      "Foreign summary",
      "published",
      "compass",
      "2026-07-29T14:00:00.000Z",
      "2026-07-29T14:00:00.000Z",
      0
    )
    mocks.requireAuth.mockResolvedValue({
      ...internalUser,
      id: "client-1",
      role: "client",
      organizationId: "org-client",
      organizationType: "client",
    })

    await expect(getProjectOwnerUpdates("project-1")).rejects.toThrow(
      "Project not found"
    )
  })

  it("replaces provider capabilities with Compass audience routes in external DTOs", () => {
    const photo = ownerUpdateExternalPhoto("project-client", {
      id: "photo-1",
      sourceSystem: "buildertrend",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      driveFileId: "drive-secret",
      driveUrl: "https://drive.google.com/file/d/drive-secret",
      thumbnailUrl: "https://drive.google.com/thumbnail/drive-secret",
      caption: "Published photo",
      capturedAt: "2026-07-28T12:00:00.000Z",
      reviewStatus: "approved",
      ownerVisible: true,
    })
    const document = ownerUpdateExternalDocument("project-client", {
      id: "document-1",
      fileName: "plan.pdf",
      mimeType: "application/pdf",
      driveFileId: "drive-secret",
      driveUrl: "https://drive.google.com/file/d/drive-secret",
      caption: "Published plan",
      capturedAt: "2026-07-28T12:00:00.000Z",
      sourceSystem: "buildertrend",
    })

    expect(photo).toMatchObject({
      driveFileId: null,
      driveUrl: null,
      thumbnailUrl: projectAudiencePhotoUrl("project-client", "photo-1", "owner"),
    })
    expect(document).toMatchObject({
      driveFileId: null,
      driveUrl: null,
      compassUrl: projectAudiencePhotoUrl("project-client", "document-1", "owner"),
    })
    expect(JSON.stringify({ photo, document })).not.toContain("drive-secret")
  })

  it("does not let an internal-looking external reader see drafts", async () => {
    seedExternalOwnerSummary(sqlite)
    mocks.requireAuth.mockResolvedValue({
      ...internalUser,
      id: "owner-1",
      role: "office",
      organizationId: "org-client",
      organizationType: "client",
    })

    const updates = await getProjectOwnerUpdates("project-client")

    expect(updates.map((update) => update.id)).toEqual(["client-published"])
  })

  it("scopes the external field summary to owner-visible data and removes provider pointers", async () => {
    seedExternalOwnerSummary(sqlite)
    mocks.requireAuth.mockResolvedValue({
      ...internalUser,
      id: "owner-1",
      role: "office",
      organizationId: "org-client",
      organizationType: "client",
    })

    const summary = await getProjectFieldSummary("project-client")

    expect(summary.dailyLogCount).toBe(1)
    expect(summary.latestDailyLog?.workCompleted).toBe("Published work")
    expect(summary.photoCount).toBe(1)
    expect(summary.latestPhotos).toEqual([
      expect.objectContaining({
        id: "client-visible-photo",
        fileName: "visible.jpg",
        driveFileId: null,
        driveUrl: null,
        thumbnailUrl: null,
      }),
    ])
    expect(summary.photoReviewFolder).toBeNull()
    expect(summary.ownerUpdateCount).toBe(1)
    expect(summary.draftOwnerUpdateCount).toBe(0)
    expect(summary.nextScheduleItem).toBeNull()
  })

  it("rejects an inactive owner-update reader before database access", async () => {
    mocks.requireAuth.mockResolvedValue({
      ...internalUser,
      isActive: false,
    })
    mocks.getCloudflareContext.mockImplementation(() => {
      throw new Error("database access reached")
    })

    await expect(getProjectOwnerUpdates("project-1")).rejects.toThrow(
      "active account"
    )
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
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
      deleteOwnerProjectUpdateDraft("project-1", "update-1", mutationVersion),
      draftOwnerProjectUpdateWithJarvis("project-1", "update-1"),
      updateOwnerProjectUpdateDraft("project-1", "update-1", draft),
      settledDenial(
        publishOwnerProjectUpdate("project-1", "update-1", mutationVersion)
      ),
      recallOwnerProjectUpdate("project-1", "update-1", mutationVersion),
    ])

    expect(results).toEqual([
      { success: false, error: "Permission denied: internal staff access is required" },
      { success: false, error: "Permission denied: internal staff access is required" },
      { success: false, error: "Permission denied: internal staff access is required" },
      { success: false, error: "Permission denied: internal staff access is required" },
      { success: false, error: "Permission denied: internal staff access is required" },
      { thrown: "Permission denied: internal staff access is required" },
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
      deleteOwnerProjectUpdateDraft("project-1", "update-1", mutationVersion),
      draftOwnerProjectUpdateWithJarvis("project-1", "update-1"),
      updateOwnerProjectUpdateDraft("project-1", "update-1", draft),
      settledDenial(
        publishOwnerProjectUpdate("project-1", "update-1", mutationVersion)
      ),
      recallOwnerProjectUpdate("project-1", "update-1", mutationVersion),
    ])

    expect(results).toEqual([
      { success: false, error: "Permission denied: active internal organization is required" },
      { success: false, error: "Permission denied: active internal organization is required" },
      { success: false, error: "Permission denied: active internal organization is required" },
      { success: false, error: "Permission denied: active internal organization is required" },
      { success: false, error: "Permission denied: active internal organization is required" },
      { thrown: "Permission denied: active internal organization is required" },
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
      deleteOwnerProjectUpdateDraft("project-2", "update-1", mutationVersion),
      draftOwnerProjectUpdateWithJarvis("project-2", "update-1"),
      updateOwnerProjectUpdateDraft("project-2", "update-1", draft),
      settledDenial(
        publishOwnerProjectUpdate("project-2", "update-1", mutationVersion)
      ),
      recallOwnerProjectUpdate("project-2", "update-1", mutationVersion),
    ])

    expect(results).toEqual([
      { success: false, error: "Project not found" },
      { success: false, error: "Project not found" },
      { success: false, error: "Project not found" },
      { success: false, error: "Project not found" },
      { success: false, error: "Project not found" },
      { thrown: "Project not found" },
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

  it("denies demo owner-update mutations before opening the database", async () => {
    mocks.isDemoUser.mockReturnValue(true)
    mocks.getCloudflareContext.mockImplementation(() => {
      throw new Error("database access reached")
    })

    const result = await updateOwnerProjectUpdateDraft(
      "project-1",
      "update-1",
      draft
    )

    expect(result).toEqual({ success: false, error: "DEMO_READ_ONLY" })
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
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

  it("does not change attachment visibility when publication CAS is stale", async () => {
    run(
      sqlite,
      "INSERT INTO daily_logs (id, project_id, log_date) VALUES (?, ?, ?)",
      "log-1",
      "project-1",
      "2026-07-28"
    )
    run(
      sqlite,
      `INSERT INTO daily_log_photos
         (id, project_id, daily_log_id, captured_at, review_status, owner_visible, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "photo-1",
      "project-1",
      "log-1",
      "2026-07-28T12:00:00.000Z",
      "pending",
      0,
      version.expectedUpdatedAt
    )
    run(
      sqlite,
      "UPDATE owner_project_updates SET selected_photo_ids = ?, revision = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(["photo-1"]),
      1,
      "2026-07-28T14:30:00.000Z",
      "update-1"
    )

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
        "SELECT review_status, owner_visible FROM daily_log_photos WHERE id = ?",
        "photo-1"
      )
    ).toEqual({ review_status: "pending", owner_visible: 0 })
  })

  it("saves and publishes 121 photos plus 29 documents under the D1 binding limit", async () => {
    const { photoIds, documentIds } = seedLargeAttachmentSelection(sqlite)

    const saved = await updateOwnerProjectUpdateDraft(
      "project-1",
      "update-1",
      {
        ...draft,
        selectedPhotoIds: photoIds,
        selectedDocumentIds: documentIds,
      }
    )
    expect(saved).toMatchObject({ success: true, revision: 1 })
    if (!saved.success) throw new Error(saved.error)

    const published = await publishOwnerProjectUpdate(
      "project-1",
      "update-1",
      { revision: saved.revision, updatedAt: saved.updatedAt }
    )

    expect(published).toMatchObject({ success: true, revision: 2 })
    expect(
      get(
        sqlite,
        "SELECT status, revision FROM owner_project_updates WHERE id = ?",
        "update-1"
      )
    ).toEqual({ status: "published", revision: 2 })
    expect(
      get(
        sqlite,
        "SELECT COUNT(*) AS count FROM daily_log_photos WHERE review_status = ? AND owner_visible = ?",
        "approved",
        1
      )
    ).toEqual({ count: 150 })
  })

  it("rejects a stale draft delete without removing the newer update", async () => {
    run(
      sqlite,
      "UPDATE owner_project_updates SET revision = ?, updated_at = ? WHERE id = ?",
      1,
      "2026-07-28T14:30:00.000Z",
      "update-1"
    )

    const result = await deleteOwnerProjectUpdateDraft(
      "project-1",
      "update-1",
      mutationVersion
    )

    expect(result).toEqual({
      success: false,
      error:
        "This owner update changed while you were deleting. Refresh and review the latest version.",
    })
    expect(
      get(sqlite, "SELECT id FROM owner_project_updates WHERE id = ?", "update-1")
    ).toEqual({ id: "update-1" })
  })

  it("rejects a stale recall without reverting the newer publication", async () => {
    run(
      sqlite,
      "UPDATE owner_project_updates SET status = ?, published_at = ?, revision = ?, updated_at = ? WHERE id = ?",
      "published",
      "2026-07-28T14:25:00.000Z",
      1,
      "2026-07-28T14:30:00.000Z",
      "update-1"
    )

    const result = await recallOwnerProjectUpdate(
      "project-1",
      "update-1",
      mutationVersion
    )

    expect(result).toEqual({
      success: false,
      error:
        "This owner update changed while you were recalling. Refresh and review the latest version.",
    })
    expect(
      get(
        sqlite,
        "SELECT status, revision, published_at FROM owner_project_updates WHERE id = ?",
        "update-1"
      )
    ).toEqual({
      status: "published",
      revision: 1,
      published_at: "2026-07-28T14:25:00.000Z",
    })
  })

  it("increments the revision when recalling a current publication", async () => {
    run(
      sqlite,
      "UPDATE owner_project_updates SET status = ?, published_at = ? WHERE id = ?",
      "published",
      "2026-07-28T14:25:00.000Z",
      "update-1"
    )
    expect(
      get(
        sqlite,
        "SELECT status, revision, updated_at FROM owner_project_updates WHERE id = ?",
        "update-1"
      )
    ).toEqual({
      status: "published",
      revision: 0,
      updated_at: version.expectedUpdatedAt,
    })

    const result = await recallOwnerProjectUpdate(
      "project-1",
      "update-1",
      mutationVersion
    )

    expect(result).toMatchObject({ success: true, revision: 1 })
    expect(
      get(
        sqlite,
        "SELECT status, revision, published_at, recalled_by FROM owner_project_updates WHERE id = ?",
        "update-1"
      )
    ).toEqual({
      status: "draft",
      revision: 1,
      published_at: null,
      recalled_by: "staff-1",
    })
  })

  it("does not let a stale Jarvis response overwrite a newer user save", async () => {
    let releaseRelay:
      | ((value: { readonly success: true; readonly text: string }) => void)
      | undefined
    mocks.generateOrganizationText.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRelay = resolve
        })
    )

    const jarvisPromise = draftOwnerProjectUpdateWithJarvis("project-1", "update-1")
    await waitForRelayCall()
    expect(mocks.generateOrganizationText).toHaveBeenCalled()

    run(
      sqlite,
      "UPDATE owner_project_updates SET summary = ?, revision = ?, updated_at = ? WHERE id = ?",
      "Newer user save",
      1,
      "2026-07-28T14:30:00.000Z",
      "update-1"
    )
    releaseRelay?.({ success: true, text: "Stale Jarvis summary" })

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
      | ((value: { readonly success: true; readonly text: string }) => void)
      | undefined
    mocks.generateOrganizationText.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRelay = resolve
        })
    )

    const jarvisPromise = draftOwnerProjectUpdateWithJarvis("project-1", "update-1")
    await waitForRelayCall()
    expect(mocks.generateOrganizationText).toHaveBeenCalled()

    run(
      sqlite,
      "UPDATE owner_project_updates SET summary = ?, status = ?, revision = ?, updated_at = ? WHERE id = ?",
      "Published user summary",
      "published",
      1,
      "2026-07-28T14:31:00.000Z",
      "update-1"
    )
    releaseRelay?.({ success: true, text: "Stale Jarvis summary" })

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
