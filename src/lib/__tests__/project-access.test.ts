import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { describe, expect, it, vi } from "vitest"

import {
  assertActiveInternalOrganization,
  assertActiveStaffOrganization,
  getProjectAudienceAccessRecord,
  getProjectAccessRecord,
} from "@/lib/project-access"

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
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'client'
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
      INSERT INTO project_members VALUES ('membership-1', 'project-b', 'user-1', 'client');
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
      INSERT INTO project_members VALUES ('membership-1', 'project-a', 'user-1', 'client');
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

  it("rejects an active same-organization user without project membership", async () => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'client', 1, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-a', 'org-a', 'A-1');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAccessRecord(getDb(), baseUser, "project-a")

    expect(access).toBeNull()
    sqlite.close()
  })

  it("rejects membership in an inactive organization", async () => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'client', 0, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-a', 'org-a', 'A-1');
      INSERT INTO project_members VALUES ('membership-1', 'project-a', 'user-1', 'client');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAccessRecord(getDb(), baseUser, "project-a")

    expect(access).toBeNull()
    sqlite.close()
  })

  it("rejects an internal staff member's cross-organization membership", async () => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'internal', 1, '2026-09-01', '2026-09-01');
      INSERT INTO organizations VALUES ('org-b', 'Org B', 'org-b', 'internal', 1, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-b', 'org-b', 'B-1');
      INSERT INTO project_members VALUES ('membership-1', 'project-b', 'user-1', 'client');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAccessRecord(
      getDb(),
      { ...baseUser, role: "project_manager", organizationType: "internal" },
      "project-b"
    )

    expect(access).toBeNull()
    sqlite.close()
  })

  it("rejects staff access when the authoritative organization is not internal", async () => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'client', 1, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-a', 'org-a', 'A-1');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAccessRecord(
      getDb(),
      { ...baseUser, role: "project_manager", organizationType: "internal" },
      "project-a"
    )

    expect(access).toBeNull()
    sqlite.close()
  })

  it("keeps developer access scoped to an assigned same-organization project", async () => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'internal', 1, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-a', 'org-a', 'A-1');
      INSERT INTO project_members VALUES ('membership-1', 'project-a', 'user-1', 'client');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAccessRecord(
      getDb(),
      { ...baseUser, role: "developer", organizationType: "internal" },
      "project-a"
    )

    expect(access).toEqual({
      id: "project-a",
      organizationId: "org-a",
      projectNumber: "A-1",
    })
    sqlite.close()
  })

  it("rejects an inactive user before project membership can grant access", async () => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'internal', 1, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-a', 'org-a', 'A-1');
      INSERT INTO project_members VALUES ('membership-1', 'project-a', 'user-1', 'client');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAccessRecord(
      getDb(),
      { ...baseUser, role: "developer", organizationType: "internal", isActive: false },
      "project-a"
    )

    expect(access).toBeNull()
    sqlite.close()
  })

  it("requires an authoritative active internal organization", async () => {
    const sqlite = openDatabase()
    sqlite.exec(
      `INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'client', 1, '2026-09-01', '2026-09-01');`
    )

    getDb.mockReturnValue(drizzle(sqlite))
    await expect(
      assertActiveInternalOrganization(getDb(), {
        ...baseUser,
        role: "admin",
        organizationType: "internal",
      })
    ).rejects.toThrow("Active internal organization is required")
    sqlite.close()
  })

  it("accepts an authoritative internal organization when the auth DTO is stale", async () => {
    const sqlite = openDatabase()
    sqlite.exec(
      `INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'internal', 1, '2026-09-01', '2026-09-01');`
    )

    getDb.mockReturnValue(drizzle(sqlite))
    await expect(
      assertActiveInternalOrganization(getDb(), {
        ...baseUser,
        role: "admin",
        organizationType: "client",
      })
    ).resolves.toBeUndefined()
    sqlite.close()
  })


  it("rejects a demo organization from staff-only provider access", async () => {
    const sqlite = openDatabase()
    sqlite.exec(
      `INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'demo', 1, '2026-09-01', '2026-09-01');`
    )

    getDb.mockReturnValue(drizzle(sqlite))
    await expect(
      assertActiveStaffOrganization(getDb(), {
        ...baseUser,
        role: "admin",
        organizationType: "internal",
      })
    ).rejects.toThrow("Active internal organization is required")
    sqlite.close()
  })


  it("requires an exact active client audience grant before media metadata", async () => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'client', 1, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-a', 'org-a', 'A-1');
      INSERT INTO project_members VALUES ('membership-1', 'project-a', 'user-1', 'client');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAudienceAccessRecord(
      getDb(),
      baseUser,
      "project-a",
      "owner"
    )

    expect(access).toEqual({
      id: "project-a",
      organizationId: "org-a",
      projectNumber: "A-1",
    })
    sqlite.close()
  })

  it("rejects an audience grant from an authoritative internal organization", async () => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'internal', 1, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-a', 'org-a', 'A-1');
      INSERT INTO project_members VALUES ('membership-1', 'project-a', 'user-1', 'client');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAudienceAccessRecord(
      getDb(),
      baseUser,
      "project-a",
      "owner"
    )

    expect(access).toBeNull()
    sqlite.close()
  })

  it.each([
    ["a mismatched audience role", "subcontractor", "owner"],
    ["a cross-organization project", "client", "owner"],
  ] as const)("rejects %s before audience metadata", async (_label, role, audience) => {
    const sqlite = openDatabase()
    sqlite.exec(`
      INSERT INTO organizations VALUES ('org-a', 'Org A', 'org-a', 'client', 1, '2026-09-01', '2026-09-01');
      INSERT INTO organizations VALUES ('org-b', 'Org B', 'org-b', 'client', 1, '2026-09-01', '2026-09-01');
      INSERT INTO projects VALUES ('project-b', 'org-b', 'B-1');
      INSERT INTO project_members VALUES ('membership-1', 'project-b', 'user-1', '${role}');
    `)

    getDb.mockReturnValue(drizzle(sqlite))
    const access = await getProjectAudienceAccessRecord(
      getDb(),
      baseUser,
      "project-b",
      audience
    )

    expect(access).toBeNull()
    sqlite.close()
  })
})
