import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { describe, expect, it, vi } from "vitest"

import { getProjectAccessRecord } from "@/lib/project-access"

const getDb = vi.fn()

function openDatabase(): InstanceType<typeof Database> {
  const sqlite = new Database(":memory:")
  sqlite.exec(`
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      type TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      project_number TEXT
    );
    CREATE TABLE project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL
    );
  `)
  return sqlite
}

const baseUser = {
  id: "user-1",
  email: "user@example.com",
  firstName: null,
  lastName: null,
  displayName: null,
  avatarUrl: null,
  role: "client",
  googleEmail: null,
  isActive: true,
  lastLoginAt: null,
  organizationId: "org-a",
  organizationName: "Org A",
  organizationType: "client",
  createdAt: "2026-09-01",
  updatedAt: "2026-09-01",
} as const

describe("project access organization boundaries", () => {
  it("rejects a cross-organization membership before returning project metadata", async () => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'client', 1, '2026-09-01', '2026-09-01');
      INSERT INTO organizations VALUES ('org-b', 'Org B', 'org-b', 'client', 1, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-b', 'org-b', 'B-1');
      INSERT INTO project_members VALUES ('membership-1', 'project-b', 'user-1');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAccessRecord(getDb(), baseUser, "project-b")

    expect(access).toBeNull()
    sqlite.close()
  })

  it("allows a member of an active same-organization project", async () => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'client', 1, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-a', 'org-a', 'A-1');
      INSERT INTO project_members VALUES ('membership-1', 'project-a', 'user-1');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAccessRecord(getDb(), baseUser, "project-a")

    expect(access).toEqual({
      id: "project-a",
      organizationId: "org-a",
      projectNumber: "A-1",
    })
    sqlite.close()
  })

  it("rejects membership in an inactive organization", async () => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'client', 0, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-a', 'org-a', 'A-1');
      INSERT INTO project_members VALUES ('membership-1', 'project-a', 'user-1');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAccessRecord(getDb(), baseUser, "project-a")

    expect(access).toBeNull()
    sqlite.close()
  })
})
