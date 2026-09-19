import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCloudflareContext: vi.fn(),
  sendOrResendWorkOSInvitation: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/lib/permissions", () => ({
  canManageUserAccess: () => true,
  requirePermission: vi.fn(),
}))
vi.mock("@/lib/demo", () => ({
  isDemoOrg: () => false,
  isDemoUser: () => false,
}))
vi.mock("@/lib/workos-invitations", () => ({
  sendOrResendWorkOSInvitation: mocks.sendOrResendWorkOSInvitation,
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import { inviteUser } from "@/app/actions/users"

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
    CREATE TABLE organization_members (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL
    );
  `)
  return sqlite
}

function insertUser(
  sqlite: InstanceType<typeof Database>,
  input: {
    readonly id: string
    readonly email: string
    readonly isActive: boolean
    readonly lastLoginAt: string | null
  }
): void {
  sqlite
    .prepare(
      `INSERT INTO users (
        id, email, display_name, role, is_active, last_login_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'office', ?, ?, '2026-08-01', '2026-08-01')`
    )
    .run(
      input.id,
      input.email,
      input.email.split("@")[0],
      input.isActive ? 1 : 0,
      input.lastLoginAt
    )
}

describe("inviteUser orphan membership recovery", () => {
  let sqlite: InstanceType<typeof Database> | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    sqlite = openDatabase()
    mocks.getCurrentUser.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      role: "admin",
      organizationId: "org-1",
    })
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        DB: createD1(sqlite),
        WORKOS_API_KEY: "sk_test",
        WORKOS_CLIENT_ID: "client_test",
      },
    })
  })

  afterEach(() => {
    sqlite?.close()
    sqlite = null
  })

  it("reattaches an orphaned pending user and resends their invitation", async () => {
    if (!sqlite) throw new Error("Test database unavailable")
    insertUser(sqlite, {
      id: "legacy-placeholder",
      email: "stanley@example.com",
      isActive: false,
      lastLoginAt: null,
    })
    mocks.sendOrResendWorkOSInvitation.mockResolvedValue({
      success: true,
      outcome: "invitation_sent",
    })

    const result = await inviteUser({
      displayName: "Stanley Platt",
      email: "Stanley@example.com",
      role: "field_superintendent",
    })

    expect(result).toEqual({ success: true, accessStatus: "invited" })
    expect(
      sqlite
        .prepare(
          "SELECT organization_id, user_id, role FROM organization_members"
        )
        .get()
    ).toEqual({
      organization_id: "org-1",
      user_id: "legacy-placeholder",
      role: "field_superintendent",
    })
  })

  it("reattaches an orphaned active user without creating a duplicate", async () => {
    if (!sqlite) throw new Error("Test database unavailable")
    insertUser(sqlite, {
      id: "local-sarah-id",
      email: "sarah@example.com",
      isActive: true,
      lastLoginAt: "2026-08-31",
    })
    mocks.sendOrResendWorkOSInvitation.mockResolvedValue({
      success: true,
      outcome: "existing_user",
      user: {
        id: "user_workos_sarah",
        email: "sarah@example.com",
        firstName: "Sarah",
        lastName: "Cowman",
        profilePictureUrl: null,
        lastSignInAt: "2026-08-31",
      },
    })

    const result = await inviteUser({
      displayName: "Sarah Cowman",
      email: "sarah@example.com",
      role: "office",
    })

    expect(result).toEqual({ success: true, accessStatus: "active" })
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()
    ).toEqual({ count: 1 })
    expect(
      sqlite.prepare("SELECT user_id FROM organization_members").get()
    ).toEqual({ user_id: "local-sarah-id" })
  })

  it("does not silently cross an existing organization boundary", async () => {
    if (!sqlite) throw new Error("Test database unavailable")
    insertUser(sqlite, {
      id: "other-org-user",
      email: "elsewhere@example.com",
      isActive: false,
      lastLoginAt: null,
    })
    sqlite
      .prepare(
        `INSERT INTO organization_members
          (id, organization_id, user_id, role, joined_at)
         VALUES ('member-other', 'org-2', 'other-org-user', 'office', '2026-08-01')`
      )
      .run()

    const result = await inviteUser({
      email: "elsewhere@example.com",
      role: "office",
    })

    expect(result).toEqual({
      success: false,
      error:
        "This user already belongs to another organization. An administrator must transfer or share their access.",
    })
    expect(mocks.sendOrResendWorkOSInvitation).not.toHaveBeenCalled()
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM organization_members").get()
    ).toEqual({ count: 1 })
  })
})
