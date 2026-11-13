import Database from "better-sqlite3"
import { afterEach, describe, expect, it, vi } from "vitest"

import { insertRow, migratedDatabase } from "@/test/migrated-database"

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

// Production's schema (every migration), so the round-trip count is measured
// against the real tables, indexes and triggers.
function openDatabase(): InstanceType<typeof Database> {
  const sqlite = migratedDatabase()
  insertRow(sqlite, "organizations", { id: "org-hps", name: "HPS", type: "internal" })
  insertRow(sqlite, "users", {
    id: "user_staff", email: "staff@example.com", display_name: "Staff Member",
    avatar_url: "https://example.com/a.png", role: "office", is_active: 1, last_login_at: RECENT_LOGIN,
    created_at: "2026-01-01", updated_at: "2026-01-01",
  })
  insertRow(sqlite, "organization_members", {
    id: "om-1", organization_id: "org-hps", user_id: "user_staff", role: "office", joined_at: "2026-01-01",
  })
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
    sqlite.exec("DELETE FROM organization_members")
    insertRow(sqlite, "organizations", { id: "org-client", name: "Client Co", type: "internal" })
    insertRow(sqlite, "users", { id: "user_admin" })
    insertRow(sqlite, "projects", { id: "project-1", organization_id: "org-client" })
    insertRow(sqlite, "project_access_invitations", {
      id: "inv-1", organization_id: "org-client", project_id: "project-1", email: "Staff@Example.com ",
      role: "client", status: "sent", invited_by: "user_admin", invited_at: "2026-10-01", updated_at: "2026-10-01",
    })
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
