import Database from "better-sqlite3"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  withAuth: vi.fn(),
  cookieSet: vi.fn(),
  ensureProjectAudienceConversation: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@workos-inc/authkit-nextjs", () => ({
  signOut: vi.fn(),
  withAuth: mocks.withAuth,
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: mocks.cookieSet }),
}))
vi.mock("@/lib/auth-config", () => ({
  isWorkOSConfigured: () => true,
  isDevAuthFallbackAllowed: () => false,
}))
vi.mock("@/lib/project-audience-conversations", () => ({
  ensureProjectAudienceConversation: mocks.ensureProjectAudienceConversation,
}))

import { getCurrentUser } from "@/lib/auth"

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

type RoundTrips = { count: number }

// Counts D1 round trips: each standalone statement is one, and a batch of
// statements is one.
function createD1(
  sqlite: InstanceType<typeof Database>,
  roundTrips: RoundTrips
): unknown {
  function prepared(
    query: string,
    values: readonly unknown[] = []
  ): D1Statement {
    const statement = sqlite.prepare(query)
    // Writes sent through all() (drizzle batches) return no rows.
    const returnsRows = /^\s*(select|with)\b/i.test(query) || /\breturning\b/i.test(query)
    const rows = (): unknown[] => {
      if (returnsRows) return statement.all(...values)
      statement.run(...values)
      return []
    }
    return {
      bind: (...nextValues) => prepared(query, nextValues),
      async all() {
        roundTrips.count += 1
        return { success: true, results: rows() }
      },
      async run() {
        roundTrips.count += 1
        const result = statement.run(...values)
        return { success: true, meta: { changes: result.changes } }
      },
      async raw() {
        roundTrips.count += 1
        return rows().map((row) =>
          row !== null && typeof row === "object" ? Object.values(row) : [row]
        )
      },
    }
  }

  return {
    prepare: (query: string): D1Statement => prepared(query),
    async batch(statements: readonly D1Statement[]) {
      const results = await Promise.all(
        statements.map(async (statement) => statement.all())
      )
      roundTrips.count -= statements.length - 1
      return results
    },
  }
}

const RECENT_LOGIN = new Date().toISOString()

function openDatabase(): InstanceType<typeof Database> {
  const sqlite = new Database(":memory:")
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, first_name TEXT,
      last_name TEXT, display_name TEXT, phone TEXT, address TEXT,
      avatar_url TEXT, dashboard_desk_photo_url TEXT,
      sidebar_desk_photo_url TEXT, role TEXT NOT NULL, google_email TEXT,
      is_active INTEGER NOT NULL, last_login_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL);
    CREATE TABLE organization_members (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL, joined_at TEXT NOT NULL
    );
    CREATE TABLE project_members (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL, assigned_at TEXT NOT NULL
    );
    CREATE TABLE project_access_invitations (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
      project_contact_id TEXT, email TEXT NOT NULL, role TEXT NOT NULL,
      status TEXT NOT NULL, invited_by TEXT NOT NULL, invited_at TEXT NOT NULL,
      workos_expires_at TEXT, accepted_by TEXT, accepted_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE project_contacts (id TEXT PRIMARY KEY, phone TEXT, address TEXT);

    INSERT INTO organizations VALUES ('org-hps', 'HPS', 'internal');
    INSERT INTO users (
      id, email, display_name, avatar_url, role, is_active, last_login_at,
      created_at, updated_at
    ) VALUES (
      'user_staff', 'staff@example.com', 'Staff Member',
      'https://example.com/a.png', 'office', 1, '${RECENT_LOGIN}',
      '2026-01-01', '2026-01-01'
    );
    INSERT INTO organization_members VALUES ('om-1', 'org-hps', 'user_staff', 'office', '2026-01-01');
  `)
  return sqlite
}

function signIn(email = "staff@example.com"): void {
  mocks.withAuth.mockResolvedValue({
    user: {
      id: "user_staff",
      email,
      firstName: "Staff",
      lastName: "Member",
      profilePictureUrl: "https://example.com/a.png",
    },
  })
}

describe("getCurrentUser D1 round trips", () => {
  let sqlite: InstanceType<typeof Database> | null = null

  afterEach(() => {
    sqlite?.close()
    sqlite = null
    vi.clearAllMocks()
  })

  it("resolves an established user in a single round trip", async () => {
    sqlite = openDatabase()
    const roundTrips = { count: 0 }
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: createD1(sqlite, roundTrips) },
    })
    signIn()

    const user = await getCurrentUser()

    expect(user).toMatchObject({
      id: "user_staff",
      role: "office",
      organizationId: "org-hps",
      organizationName: "HPS",
      organizationType: "internal",
    })
    expect(roundTrips.count).toBe(1)
  })

  it("still claims a pending invitation and reports the new membership", async () => {
    sqlite = openDatabase()
    sqlite.exec(`
      DELETE FROM organization_members;
      INSERT INTO organizations VALUES ('org-client', 'Client Co', 'internal');
      INSERT INTO project_access_invitations (
        id, organization_id, project_id, email, role, status, invited_by,
        invited_at, updated_at
      ) VALUES (
        'inv-1', 'org-client', 'project-1', 'Staff@Example.com ', 'client',
        'sent', 'user_admin', '2026-10-01', '2026-10-01'
      );
    `)
    const roundTrips = { count: 0 }
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: createD1(sqlite, roundTrips) },
    })
    signIn()

    const user = await getCurrentUser()

    expect(user).toMatchObject({
      id: "user_staff",
      role: "client",
      organizationId: "org-client",
    })
    expect(
      sqlite
        .prepare("SELECT status, accepted_by FROM project_access_invitations")
        .get()
    ).toEqual({ status: "accepted", accepted_by: "user_staff" })
    expect(
      sqlite.prepare("SELECT project_id, role FROM project_members").get()
    ).toEqual({ project_id: "project-1", role: "client" })
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "compass-active-org",
      "org-client",
      expect.anything()
    )
  })
})
