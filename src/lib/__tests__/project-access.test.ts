import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { assertProjectAccess } from "@/lib/project-access"
import type { AuthUser } from "@/lib/auth"

type D1Statement = Readonly<{
  readonly __query: string
  readonly bind: (...values: unknown[]) => D1Statement
  readonly all: () => Promise<Readonly<{
    readonly success: true
    readonly results: readonly unknown[]
  }>>
  readonly raw: () => Promise<readonly unknown[][]>
}>

function createD1(sqlite: InstanceType<typeof Database>) {
  function prepared(query: string, values: readonly unknown[] = []): D1Statement {
    const statement = sqlite.prepare(query)
    return {
      __query: query,
      bind: (...nextValues) => prepared(query, nextValues),
      async all() {
        return { success: true, results: statement.all(...values) }
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

function createDatabase(): InstanceType<typeof Database> {
  const sqlite = new Database(":memory:")
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      project_number TEXT,
      organization_id TEXT
    );
    CREATE TABLE project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      assigned_at TEXT NOT NULL
    );
    INSERT INTO projects (id, project_number, organization_id) VALUES
      ('project-1', 'P-1', 'org-1'),
      ('project-2', 'P-2', 'org-2');
    INSERT INTO project_members (id, project_id, user_id, role, assigned_at) VALUES
      ('member-1', 'project-1', 'viewer-1', 'client', '2026-09-06T00:00:00.000Z');
  `)
  return sqlite
}

function user(input: {
  readonly id: string
  readonly organizationId: string | null
  readonly organizationType: string | null
  readonly role: string
}): AuthUser {
  return {
    id: input.id,
    email: `${input.id}@example.com`,
    firstName: null,
    lastName: null,
    displayName: input.id,
    avatarUrl: null,
    role: input.role,
    googleEmail: null,
    isActive: true,
    lastLoginAt: null,
    organizationId: input.organizationId,
    organizationName: null,
    organizationType: input.organizationType,
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  }
}

describe("assertProjectAccess photo-route boundary", () => {
  it("allows a project member for the exact project", async () => {
    const sqlite = createDatabase()
    try {
      const d1 = createD1(sqlite)
      // This focused adapter implements only the D1 methods exercised here.
      // @ts-expect-error The focused adapter omits unused D1 methods.
      const db = getDb(d1)
      await expect(
        assertProjectAccess(
          db,
          user({
            id: "viewer-1",
            organizationId: "org-1",
            organizationType: "client",
            role: "client",
          }),
          "project-1"
        )
      ).resolves.toMatchObject({ id: "project-1", organizationId: "org-1" })
    } finally {
      sqlite.close()
    }
  })

  it("rejects a member request for a different project", async () => {
    const sqlite = createDatabase()
    try {
      const d1 = createD1(sqlite)
      // This focused adapter implements only the D1 methods exercised here.
      // @ts-expect-error The focused adapter omits unused D1 methods.
      const db = getDb(d1)
      await expect(
        assertProjectAccess(
          db,
          user({
            id: "viewer-1",
            organizationId: "org-1",
            organizationType: "client",
            role: "client",
          }),
          "project-2"
        )
      ).rejects.toThrow("Project not found")
    } finally {
      sqlite.close()
    }
  })

  it("rejects an internal user from another organization without membership", async () => {
    const sqlite = createDatabase()
    try {
      const d1 = createD1(sqlite)
      // This focused adapter implements only the D1 methods exercised here.
      // @ts-expect-error The focused adapter omits unused D1 methods.
      const db = getDb(d1)
      await expect(
        assertProjectAccess(
          db,
          user({
            id: "staff-1",
            organizationId: "org-1",
            organizationType: "internal",
            role: "admin",
          }),
          "project-2"
        )
      ).rejects.toThrow("Project not found")
    } finally {
      sqlite.close()
    }
  })
})
