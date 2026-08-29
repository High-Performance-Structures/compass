import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  buildBuildertrendLeadProjectCutoverSql,
  parseBuildertrendLeadProjectCutover,
} from "../lead-project-cutover"

const stagingMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0084_buildertrend_staging_foundation.sql"),
  "utf8",
).replaceAll("--> statement-breakpoint", "")

type TestStatement = {
  readonly all: () => readonly unknown[]
  readonly get: () => unknown
}

type TestDatabase = {
  readonly exec: (sql: string) => unknown
  readonly prepare: (sql: string) => TestStatement
  readonly close: () => void
}

type TestDatabaseModule = {
  readonly Database: new (filename: string) => TestDatabase
}

function isTestDatabaseModule(value: unknown): value is TestDatabaseModule {
  return (
    value !== null &&
    typeof value === "object" &&
    "Database" in value &&
    typeof value.Database === "function"
  )
}

async function createDatabase(): Promise<TestDatabase> {
  if ("Bun" in globalThis) {
    const bunSqliteSpecifier = "bun:sqlite"
    const sqliteModule: unknown = await import(bunSqliteSpecifier)
    if (!isTestDatabaseModule(sqliteModule)) {
      throw new Error("bun:sqlite did not provide a Database constructor")
    }
    return new sqliteModule.Database(":memory:")
  }
  const { default: Database } = await import("better-sqlite3")
  return new Database(":memory:")
}

async function createCutoverDatabase(): Promise<TestDatabase> {
  const database = await createDatabase()
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT);
    CREATE TABLE customers (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT);
    CREATE TABLE vendors (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT);
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      project_number TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      address TEXT,
      client_status TEXT NOT NULL DEFAULT 'customer',
      job_status_id TEXT NOT NULL DEFAULT 'current',
      client_name TEXT,
      project_manager TEXT,
      organization_id TEXT,
      google_drive_folder_id TEXT,
      owner_updates_enabled INTEGER NOT NULL DEFAULT 1,
      owner_update_channel TEXT NOT NULL DEFAULT 'compass',
      owner_update_cadence TEXT NOT NULL DEFAULT 'weekly',
      owner_schedule_view TEXT NOT NULL DEFAULT 'items',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
  `)
  database.exec(stagingMigration)
  database.exec("INSERT INTO organizations (id) VALUES ('org-a')")
  return database
}

const input = {
  runKey: "live-lead-cutover-2026-08-28",
  sourceLabel: "Buildertrend live lead capture",
  capturedAt: "2026-08-28T12:00:00.000Z",
  leads: [
    {
      buildertrendLeadId: "2001",
      stableProjectKey: "D-100-example",
      projectName: "Example Design Project",
      projectNumber: "BT-100",
      googleDriveProjectFolderId: "drive-folder-new",
      title: "Example Design Project lead",
      href: "/app/leads/opportunities/Lead/2001",
      clientName: "Example Owner",
      contacts: [{ name: "Example Owner", email: "owner@example.test" }],
    },
    {
      buildertrendLeadId: "2002",
      stableProjectKey: "D-100-example",
      projectName: "Example Design Project",
      projectNumber: "BT-100",
      googleDriveProjectFolderId: "drive-folder-new",
      title: "Example Design Project continuation",
      href: "/app/leads/opportunities/Lead/2002",
      contacts: [{ name: "Example Owner", phone: "555-0101" }],
    },
    {
      buildertrendLeadId: "3001",
      stableProjectKey: "D-200-existing",
      existingProjectId: "existing-project",
      title: "Existing Compass conversion",
      href: "/app/leads/opportunities/Lead/3001",
      contactName: "Converted Owner",
      contactEmail: "converted@example.test",
    },
  ],
}

describe("Buildertrend lead-to-project cutover", () => {
  it("validates new-project Drive requirements and groups duplicate project keys", async () => {
    const missingFolder = {
      ...input,
      leads: input.leads.map((lead, index) =>
        index < 2
          ? { ...lead, googleDriveProjectFolderId: undefined }
          : lead,
      ),
    }
    const parsed = parseBuildertrendLeadProjectCutover(missingFolder, "org-a")
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.errors.join("\n")).toContain(
        "googleDriveProjectFolderId is required for a new project",
      )
    }

    const build = await buildBuildertrendLeadProjectCutoverSql("org-a", input)
    expect(build.summary).toEqual({
      runKey: "live-lead-cutover-2026-08-28",
      leadCount: 3,
      projectCount: 2,
      newProjectCount: 1,
      existingProjectLinkCount: 1,
      accessCandidateCount: 3,
    })
    expect(build.sql).toContain("buildertrend-lead-project:org-a:d-100-example")
    expect(build.sql).toContain("drive-folder-new")
    expect(build.sql).toContain("existing-project")
    expect(build.sql).toContain("portal_access_status")
    expect(build.sql).toContain("'not_granted'")
    expect(build.sql).toContain("'drive-folder-new', 0, 'compass'")
    expect(build.sql).not.toMatch(/INSERT INTO (?:project_members|notifications|sage_)/i)
  })

  it("accepts established Buildertrend hosts and rejects untrusted URLs", () => {
    for (const href of [
      "https://app.buildertrend.net/app/leads/opportunities/Lead/2001",
      "https://buildertrend.com/app/leads/opportunities/Lead/2001",
    ]) {
      const result = parseBuildertrendLeadProjectCutover(
        {
          ...input,
          leads: input.leads.map((lead, index) =>
            index === 0 ? { ...lead, href } : lead,
          ),
        },
        "org-a",
      )
      expect(result.success).toBe(true)
    }

    const untrusted = parseBuildertrendLeadProjectCutover(
      {
        ...input,
        leads: input.leads.map((lead, index) =>
          index === 0
            ? { ...lead, href: "https://buildertrend.example/app/leads/opportunities/Lead/2001" }
            : lead,
        ),
      },
      "org-a",
    )
    expect(untrusted.success).toBe(false)
  })

  it("rejects duplicate lead identities and conflicting grouped targets", async () => {
    const duplicate = {
      ...input,
      leads: input.leads.map((lead, index) =>
        index === 1 ? { ...lead, buildertrendLeadId: "2001" } : lead,
      ),
    }
    const duplicateResult = parseBuildertrendLeadProjectCutover(duplicate, "org-a")
    expect(duplicateResult.success).toBe(false)
    if (!duplicateResult.success) {
      expect(duplicateResult.errors.join("\n")).toContain(
        "duplicate Buildertrend lead ID 2001",
      )
    }

    const conflict = {
      ...input,
      leads: input.leads.map((lead, index) =>
        index === 1
          ? { ...lead, googleDriveProjectFolderId: "another-folder" }
          : lead,
      ),
    }
    const conflictResult = parseBuildertrendLeadProjectCutover(conflict, "org-a")
    expect(conflictResult.success).toBe(true)
    if (conflictResult.success) {
      await expect(
        buildBuildertrendLeadProjectCutoverSql("org-a", conflictResult.data),
      ).rejects.toThrow("must use one Google Drive project folder")
    }
  })

  it("executes and replays without operational or access side effects", async () => {
    const database = await createCutoverDatabase()
    database.exec(`
      INSERT INTO projects (id, name, organization_id, created_at)
      VALUES ('existing-project', 'Existing project', 'org-a', '2026-01-01T00:00:00.000Z');
    `)
    const build = await buildBuildertrendLeadProjectCutoverSql("org-a", input)
    database.exec(build.sql)
    database.exec(build.sql)

    expect(database.prepare("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 2 })
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM buildertrend_staging_records")
        .get(),
    ).toEqual({ count: 3 })
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM buildertrend_staging_records WHERE project_id = 'buildertrend-lead-project:org-a:d-100-example'",
        )
        .get(),
    ).toEqual({ count: 2 })
    expect(
      database
        .prepare(
          "SELECT project_number, owner_updates_enabled FROM projects WHERE id = 'buildertrend-lead-project:org-a:d-100-example'",
        )
        .get(),
    ).toEqual({ project_number: "BT-100", owner_updates_enabled: 0 })
    expect(
      database
        .prepare(
          "SELECT project_id FROM buildertrend_staging_records WHERE buildertrend_lead_id = '3001'",
        )
        .get(),
    ).toEqual({ project_id: "existing-project" })
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM buildertrend_staging_access_candidates WHERE portal_access_status <> 'not_granted'",
        )
        .get(),
    ).toEqual({ count: 0 })
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM buildertrend_staging_observations")
        .get(),
    ).toEqual({ count: 6 })
    database.close()
  })

  it("fails closed on project-number and Drive-folder collisions", async () => {
    const numberDatabase = await createCutoverDatabase()
    numberDatabase.exec(`
      INSERT INTO projects (id, name, organization_id, created_at)
      VALUES ('existing-project', 'Existing project', 'org-a', '2026-01-01T00:00:00.000Z');
      INSERT INTO projects (id, name, project_number, organization_id, created_at)
      VALUES ('occupied-number', 'Occupied number', 'BT-100', 'org-a', '2026-01-01T00:00:00.000Z');
    `)
    const build = await buildBuildertrendLeadProjectCutoverSql("org-a", input)
    expect(build.sql).toContain("Buildertrend cutover collision guard")
    const numberCollisionGuard = build.statements.find((statement) =>
      statement.includes("Buildertrend cutover collision guard"),
    )
    if (!numberCollisionGuard) throw new Error("collision guard statement was not generated")
    expect(() => numberDatabase.exec(numberCollisionGuard)).toThrow()
    expect(
      numberDatabase
        .prepare("SELECT COUNT(*) AS count FROM buildertrend_staging_records")
        .get(),
    ).toEqual({ count: 0 })
    numberDatabase.close()

    const driveDatabase = await createCutoverDatabase()
    driveDatabase.exec(`
      INSERT INTO projects (id, name, organization_id, created_at)
      VALUES ('existing-project', 'Existing project', 'org-a', '2026-01-01T00:00:00.000Z');
      INSERT INTO projects (id, name, organization_id, google_drive_folder_id, created_at)
      VALUES ('occupied-drive', 'Occupied Drive folder', 'org-a', 'drive-folder-new', '2026-01-01T00:00:00.000Z');
    `)
    const driveCollisionGuard = build.statements.find((statement) =>
      statement.includes("Buildertrend cutover collision guard"),
    )
    if (!driveCollisionGuard) throw new Error("collision guard statement was not generated")
    expect(() => driveDatabase.exec(driveCollisionGuard)).toThrow()
    expect(
      driveDatabase
        .prepare("SELECT COUNT(*) AS count FROM buildertrend_staging_records")
        .get(),
    ).toEqual({ count: 0 })
    driveDatabase.close()
  })

  it("fails closed before creating new projects when an existing mapping is missing", async () => {
    const database = await createCutoverDatabase()
    const missingExisting = {
      ...input,
      leads: input.leads.map((lead, index) =>
        index === 2 ? { ...lead, existingProjectId: "missing-project" } : lead,
      ),
    }
    const build = await buildBuildertrendLeadProjectCutoverSql("org-a", missingExisting)
    const missingProjectGuard = build.statements.find((statement) =>
      statement.includes("Buildertrend cutover project reference guard") &&
      statement.includes("missing-project"),
    )
    if (!missingProjectGuard) throw new Error("missing-project guard statement was not generated")
    expect(() => database.exec(missingProjectGuard)).toThrow()
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM projects WHERE id = 'buildertrend-lead-project:org-a:d-100-example'",
        )
        .get(),
    ).toEqual({ count: 0 })
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM buildertrend_staging_records")
        .get(),
    ).toEqual({ count: 0 })
    database.close()
  })
})
