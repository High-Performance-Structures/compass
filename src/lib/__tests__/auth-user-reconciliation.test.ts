import Database from "better-sqlite3"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@workos-inc/authkit-nextjs", () => ({
  signOut: vi.fn(),
  withAuth: vi.fn(),
}))
vi.mock("next/headers", () => ({ cookies: vi.fn() }))

import { ensureUserExists } from "@/lib/auth"

type D1Statement = Readonly<{
  readonly bind: (...values: readonly unknown[]) => D1Statement
  readonly all: () => Promise<{
    readonly success: true
    readonly results: readonly unknown[]
  }>
  readonly run: () => Promise<{
    readonly success: true
    readonly meta: { readonly changes: number }
  }>
  readonly raw: () => Promise<readonly unknown[][]>
}>

function createD1(sqlite: InstanceType<typeof Database>): unknown {
  function prepared(
    query: string,
    values: readonly unknown[] = []
  ): D1Statement {
    const statement = sqlite.prepare(query)
    return {
      bind: (...nextValues) => prepared(query, nextValues),
      async all() {
        return { success: true, results: statement.all(...values) }
      },
      async run() {
        const result = statement.run(...values)
        return {
          success: true,
          meta: { changes: result.changes },
        }
      },
      async raw() {
        return statement.all(...values).map((row) =>
          row !== null && typeof row === "object" ? Object.values(row) : [row]
        )
      },
    }
  }

  return {
    prepare(query: string): D1Statement {
      return prepared(query)
    },
    async batch(statements: readonly D1Statement[]) {
      return Promise.all(statements.map(async (statement) => statement.all()))
    },
  }
}

function openDatabase(): InstanceType<typeof Database> {
  const sqlite = new Database(":memory:")
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      first_name TEXT,
      last_name TEXT,
      display_name TEXT,
      phone TEXT,
      address TEXT,
      avatar_url TEXT,
      dashboard_desk_photo_url TEXT,
      sidebar_desk_photo_url TEXT,
      role TEXT NOT NULL,
      google_email TEXT,
      is_active INTEGER NOT NULL,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE project_access_invitations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_contact_id TEXT,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      invited_at TEXT NOT NULL,
      workos_expires_at TEXT,
      accepted_by TEXT,
      accepted_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE project_contacts (
      id TEXT PRIMARY KEY,
      phone TEXT,
      address TEXT
    );
  `)
  return sqlite
}

describe("ensureUserExists WorkOS identity reconciliation", () => {
  let sqlite: InstanceType<typeof Database> | null = null

  afterEach(() => {
    sqlite?.close()
    sqlite = null
    vi.clearAllMocks()
  })

  it("activates an email-matched placeholder without changing its local ID", async () => {
    sqlite = openDatabase()
    sqlite
      .prepare(
        `INSERT INTO users (
          id, email, display_name, role, is_active, created_at, updated_at
        ) VALUES (
          'legacy-placeholder', 'Stanley@Example.com', 'Stanley Platt',
          'field_superintendent', 0, '2026-08-01', '2026-08-01'
        )`
      )
      .run()
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: createD1(sqlite) },
    })

    const result = await ensureUserExists({
      id: "user_workos_stanley",
      email: "stanley@example.com",
      firstName: "Stanley",
      lastName: "Platt",
      profilePictureUrl: "https://example.com/avatar.png",
    })

    expect(result).toMatchObject({
      id: "legacy-placeholder",
      email: "stanley@example.com",
      displayName: "Stanley Platt",
      role: "field_superintendent",
      isActive: true,
      avatarUrl: "https://example.com/avatar.png",
    })
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()
    ).toEqual({ count: 1 })
    expect(
      sqlite
        .prepare("SELECT id, is_active, last_login_at FROM users")
        .get()
    ).toMatchObject({
      id: "legacy-placeholder",
      is_active: 1,
    })
  })

  it("does not reactivate a deliberately deactivated email match", async () => {
    sqlite = openDatabase()
    sqlite
      .prepare(
        `INSERT INTO users (
          id, email, display_name, role, is_active, last_login_at,
          created_at, updated_at
        ) VALUES (
          'user_deactivated', 'former@example.com', 'Former User',
          'office', 0, '2026-07-01', '2026-06-01', '2026-08-01'
        )`
      )
      .run()
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: createD1(sqlite) },
    })

    await expect(
      ensureUserExists({
        id: "user_new_workos_identity",
        email: "former@example.com",
        firstName: "Former",
        lastName: "User",
      })
    ).rejects.toThrow(
      "This Compass account is inactive. Ask an administrator to restore access."
    )
    expect(
      sqlite.prepare("SELECT id, is_active FROM users").get()
    ).toEqual({ id: "user_deactivated", is_active: 0 })
  })
})
