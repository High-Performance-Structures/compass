import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { PROJECT_JOB_STATUS_DEFINITIONS } from "@/lib/project-profile"

type TestStatement = {
  readonly get: () => unknown
}

type TestDatabase = {
  readonly exec: (query: string) => void
  readonly prepare: (query: string) => TestStatement
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

const profileMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0101_project_profile_follow_up.sql"),
  "utf8",
)
const namespaceMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0108_project_job_status_label_namespace.sql"),
  "utf8",
)
const underWarrantyMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0144_project_under_warranty_job_status.sql"),
  "utf8",
)

async function openDatabase(): Promise<TestDatabase> {
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

function scalar(database: TestDatabase, query: string): unknown {
  const row = database.prepare(query).get()
  if (row === null || typeof row !== "object" || !("value" in row)) {
    throw new Error("Expected a scalar result")
  }
  return row.value
}

describe("project job-status label namespace migration", () => {
  it("reconciles case-variant custom statuses without losing project references", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'OPEN'
        );
        INSERT INTO organizations (id) VALUES ('org-1'), ('org-2');
      `)
      database.exec(profileMigration)
      database.exec(`
        INSERT INTO project_job_statuses (
          id, organization_id, label, active, sort_order, created_at, updated_at
        ) VALUES
          ('status-a', 'org-1', 'Warranty', 1, 1000, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
          ('status-b', 'org-1', 'warranty', 1, 1000, '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'),
          ('status-c', 'org-1', 'WARRANTY', 1, 1000, '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'),
          ('status-tie-z', 'org-1', 'Turnover', 1, 1000, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z'),
          ('status-tie-a', 'org-1', 'turnover', 1, 1000, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z'),
          ('status-org2', 'org-2', 'Warranty', 1, 1000, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z');
        INSERT INTO projects (id, organization_id, status, job_status_id)
        VALUES
          ('project-1', 'org-1', 'OPEN', 'status-b'),
          ('project-2', 'org-1', 'OPEN', 'status-c'),
          ('project-3', 'org-1', 'OPEN', 'status-tie-z');
      `)

      database.exec(namespaceMigration)

      expect(
        scalar(
          database,
          "SELECT job_status_id AS value FROM projects WHERE id = 'project-1'",
        ),
      ).toBe("status-a")
      expect(
        scalar(
          database,
          "SELECT job_status_id AS value FROM projects WHERE id = 'project-2'",
        ),
      ).toBe("status-a")
      expect(
        scalar(
          database,
          "SELECT job_status_id AS value FROM projects WHERE id = 'project-3'",
        ),
      ).toBe("status-tie-a")
      expect(
        scalar(
          database,
          "SELECT COUNT(*) AS value FROM project_job_statuses WHERE organization_id = 'org-1'",
        ),
      ).toBe(2)
      expect(
        scalar(
          database,
          "SELECT normalized_label AS value FROM project_job_status_label_keys WHERE status_id = 'status-a'",
        ),
      ).toBe("warranty")
      expect(
        scalar(
          database,
          "SELECT status_id AS value FROM project_job_status_label_keys WHERE organization_id = 'org-1' AND normalized_label = 'turnover'",
        ),
      ).toBe("status-tie-a")
      expect(
        scalar(
          database,
          "SELECT status_id AS value FROM project_job_status_label_keys WHERE organization_id = 'org-2' AND normalized_label = 'warranty'",
        ),
      ).toBe("status-org2")
      expect(
        scalar(
          database,
          "SELECT retained_status_id AS value FROM project_job_status_label_conflicts WHERE discarded_status_id = 'status-b'",
        ),
      ).toBe("status-a")
      expect(
        scalar(
          database,
          "SELECT discarded_label AS value FROM project_job_status_label_conflicts WHERE discarded_status_id = 'status-b'",
        ),
      ).toBe("warranty")
      expect(() =>
        database.exec(`
          INSERT INTO project_job_statuses (
            id, organization_id, label, active, sort_order, created_at, updated_at
          ) VALUES ('status-d', 'org-1', 'WARRANTY', 1, 1000, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z')
        `),
      ).toThrow()
      expect(() =>
        database.exec(`
          INSERT INTO project_job_statuses (
            id, organization_id, label, active, sort_order, created_at, updated_at
          ) VALUES ('status-empty', 'org-1', '', 1, 1000, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z')
        `),
      ).toThrow()
      expect(() =>
        database.exec(`
          INSERT INTO project_job_statuses (
            id, organization_id, label, active, sort_order, created_at, updated_at
          ) VALUES ('status-nul', 'org-1', 'Good' || char(0) || 'Bad', 1, 1000, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z')
        `),
      ).toThrow(/Project job-status labels must be non-empty, trimmed printable ASCII/)
      expect(() =>
        database.exec("UPDATE project_job_status_label_keys SET normalized_label = 'tampered' WHERE status_id = 'status-a'"),
      ).toThrow(/Project job-status label key must match its status/)
      expect(() =>
        database.exec("DELETE FROM project_job_status_label_keys WHERE status_id = 'status-a'"),
      ).toThrow(/Project job-status label key cannot be removed/)
      database.exec("UPDATE project_job_statuses SET label = 'Coverage' WHERE id = 'status-a'")
      expect(
        scalar(
          database,
          "SELECT normalized_label AS value FROM project_job_status_label_keys WHERE status_id = 'status-a'",
        ),
      ).toBe("coverage")
      database.exec(namespaceMigration)
      expect(
        scalar(
          database,
          "SELECT normalized_label AS value FROM project_job_status_label_keys WHERE status_id = 'status-a'",
        ),
      ).toBe("coverage")
    } finally {
      database.close()
    }
  })

  it("fails closed for legacy Unicode labels and resumes after remediation", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'OPEN'
        );
        INSERT INTO organizations (id) VALUES ('org-1'), ('org-2');
      `)
      database.exec(profileMigration)
      database.exec(`
        INSERT INTO project_job_statuses (
          id, organization_id, label, active, sort_order, created_at, updated_at
        ) VALUES ('status-unicode', 'org-1', 'État', 1, 1000, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
      `)

      expect(() => database.exec(namespaceMigration)).toThrow(/project_job_status_label_ascii/)
      database.exec("UPDATE project_job_statuses SET label = 'Etat' WHERE id = 'status-unicode'")
      database.exec(namespaceMigration)
      expect(
        scalar(
          database,
          "SELECT normalized_label AS value FROM project_job_status_label_keys WHERE status_id = 'status-unicode'",
        ),
      ).toBe("etat")
    } finally {
      database.close()
    }
  })

  it("fails closed before deleting a duplicate referenced by a project without an organization", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT,
          status TEXT NOT NULL DEFAULT 'OPEN'
        );
        INSERT INTO organizations (id) VALUES ('org-1');
      `)
      database.exec(profileMigration)
      database.exec(`
        INSERT INTO project_job_statuses (
          id, organization_id, label, active, sort_order, created_at, updated_at
        ) VALUES
          ('status-early', 'org-1', 'Warranty', 1, 1000, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
          ('status-late', 'org-1', 'warranty', 1, 1000, '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z');
        INSERT INTO projects (id, organization_id, status, job_status_id)
        VALUES ('project-null-organization', NULL, 'OPEN', 'status-late');
      `)

      expect(() => database.exec(namespaceMigration)).toThrow(
        /project_job_status_cross_tenant_reference/,
      )
      expect(
        scalar(
          database,
          "SELECT COUNT(*) AS value FROM project_job_statuses WHERE organization_id = 'org-1'",
        ),
      ).toBe(2)
      expect(
        scalar(
          database,
          "SELECT job_status_id AS value FROM projects WHERE id = 'project-null-organization'",
        ),
      ).toBe("status-late")
    } finally {
      database.close()
    }
  })

  it("fails closed before deleting a duplicate referenced across organizations", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'OPEN'
        );
        INSERT INTO organizations (id) VALUES ('org-1'), ('org-2');
      `)
      database.exec(profileMigration)
      database.exec(`
        INSERT INTO project_job_statuses (
          id, organization_id, label, active, sort_order, created_at, updated_at
        ) VALUES
          ('status-early', 'org-1', 'Warranty', 1, 1000, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
          ('status-late', 'org-1', 'warranty', 1, 1000, '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z');
        INSERT INTO projects (id, organization_id, status, job_status_id)
        VALUES ('project-cross-tenant', 'org-2', 'OPEN', 'status-late');
      `)

      expect(() => database.exec(namespaceMigration)).toThrow(
        /project_job_status_cross_tenant_reference/,
      )
      expect(
        scalar(
          database,
          "SELECT COUNT(*) AS value FROM project_job_statuses WHERE organization_id = 'org-1'",
        ),
      ).toBe(2)
      expect(
        scalar(
          database,
          "SELECT job_status_id AS value FROM projects WHERE id = 'project-cross-tenant'",
        ),
      ).toBe("status-late")
    } finally {
      database.close()
    }
  })

  it("fails closed for legacy labels containing an embedded NUL", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN');
        INSERT INTO organizations (id) VALUES ('org-1');
      `)
      database.exec(profileMigration)
      database.exec(`
        INSERT INTO project_job_statuses (id, organization_id, label, active, sort_order, created_at, updated_at)
        VALUES ('nul-status', 'org-1', 'Good' || char(0) || 'Bad', 1, 1000, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
      `)

      expect(() => database.exec(namespaceMigration)).toThrow(/project_job_status_label_ascii/)
      expect(scalar(database, "SELECT COUNT(*) AS value FROM project_job_statuses")).toBe(1)
    } finally {
      database.close()
    }
  })

  it("fails closed for a whitespace-invalid retained legacy duplicate", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN');
        INSERT INTO organizations (id) VALUES ('org-1');
      `)
      database.exec(profileMigration)
      database.exec(`
        INSERT INTO project_job_statuses (id, organization_id, label, active, sort_order, created_at, updated_at)
        VALUES
          ('early-space', 'org-1', ' Warranty ', 1, 1000, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
          ('later-valid', 'org-1', 'warranty', 1, 1000, '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z')
      `)

      expect(() => database.exec(namespaceMigration)).toThrow(/project_job_status_label_ascii/)
      expect(scalar(database, "SELECT COUNT(*) AS value FROM project_job_statuses")).toBe(2)
    } finally {
      database.close()
    }
  })

  it("fails closed for a unique custom status referenced across organizations", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT, status TEXT NOT NULL DEFAULT 'OPEN');
        INSERT INTO organizations (id) VALUES ('org-1'), ('org-2');
      `)
      database.exec(profileMigration)
      database.exec(`
        INSERT INTO project_job_statuses (id, organization_id, label, active, sort_order, created_at, updated_at)
        VALUES ('unique-org-1', 'org-1', 'Warranty', 1, 1000, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
        INSERT INTO projects (id, organization_id, status, job_status_id)
        VALUES ('cross-tenant-unique', 'org-2', 'OPEN', 'unique-org-1');
      `)

      expect(() => database.exec(namespaceMigration)).toThrow(/project_job_status_cross_tenant_reference/)
      expect(scalar(database, "SELECT job_status_id AS value FROM projects WHERE id = 'cross-tenant-unique'")).toBe("unique-org-1")
    } finally {
      database.close()
    }
  })

  it("fails closed for a unique custom status referenced by a project without an organization", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT, status TEXT NOT NULL DEFAULT 'OPEN');
        INSERT INTO organizations (id) VALUES ('org-1');
      `)
      database.exec(profileMigration)
      database.exec(`
        INSERT INTO project_job_statuses (id, organization_id, label, active, sort_order, created_at, updated_at)
        VALUES ('unique-org-1', 'org-1', 'Warranty', 1, 1000, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
        INSERT INTO projects (id, organization_id, status, job_status_id)
        VALUES ('null-tenant-unique', NULL, 'OPEN', 'unique-org-1');
      `)

      expect(() => database.exec(namespaceMigration)).toThrow(/project_job_status_cross_tenant_reference/)
      expect(scalar(database, "SELECT job_status_id AS value FROM projects WHERE id = 'null-tenant-unique'")).toBe("unique-org-1")
    } finally {
      database.close()
    }
  })

  it("rejects future cross-tenant, NULL-tenant, and unknown custom project-status writes", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT, status TEXT NOT NULL DEFAULT 'OPEN');
        INSERT INTO organizations (id) VALUES ('org-1'), ('org-2');
      `)
      database.exec(profileMigration)
      database.exec(`
        INSERT INTO project_job_statuses (id, organization_id, label, active, sort_order, created_at, updated_at)
        VALUES ('org-1-custom', 'org-1', 'Warranty', 1, 1000, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
        INSERT INTO projects (id, organization_id, status, job_status_id)
        VALUES ('project-org-2', 'org-2', 'OPEN', 'current');
      `)
      database.exec(namespaceMigration)
      expect(() =>
        database.exec("UPDATE projects SET job_status_id = 'under_warranty' WHERE id = 'project-org-2'"),
      ).toThrow(/Project job status/)
      database.exec(underWarrantyMigration)
      database.exec(underWarrantyMigration)

      expect(() => database.exec("UPDATE projects SET job_status_id = 'org-1-custom' WHERE id = 'project-org-2'")).toThrow(/Project job status/)
      expect(() => database.exec("UPDATE projects SET organization_id = NULL, job_status_id = 'org-1-custom' WHERE id = 'project-org-2'")).toThrow(/Project job status/)
      expect(() => database.exec("UPDATE projects SET job_status_id = 'not-a-built-in-or-custom-status' WHERE id = 'project-org-2'")).toThrow(/Project job status/)
      expect(() => database.exec("UPDATE projects SET job_status_id = 'current' WHERE id = 'project-org-2'")).not.toThrow()
      for (const status of PROJECT_JOB_STATUS_DEFINITIONS) {
        expect(() =>
          database.exec(
            `UPDATE projects SET job_status_id = '${status.id}' WHERE id = 'project-org-2'`,
          ),
        ).not.toThrow()
      }
    } finally {
      database.close()
    }
  })
})
