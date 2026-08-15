import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"

import { buildLegacyBuildertrendReconciliationSql } from "../legacy-reconciliation"

type TestStatement = {
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
  const sqliteModule: unknown = await import("bun:sqlite")
  if (!isTestDatabaseModule(sqliteModule)) {
    throw new Error("bun:sqlite did not provide a Database constructor")
  }
  return new sqliteModule.Database(":memory:")
}

const guardedMigrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0084_buildertrend_staging_foundation.sql"),
  "utf8"
).replaceAll("--> statement-breakpoint", "")

const legacySchemaSql = `
CREATE TABLE buildertrend_import_runs (
  id TEXT PRIMARY KEY, organization_id TEXT, source_method TEXT NOT NULL,
  source_label TEXT NOT NULL, status TEXT NOT NULL, started_by TEXT,
  started_at TEXT NOT NULL, completed_at TEXT,
  raw_artifact_drive_file_id TEXT, raw_artifact_drive_url TEXT, notes TEXT,
  summary_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE buildertrend_source_records (
  id TEXT PRIMARY KEY, import_run_id TEXT NOT NULL, organization_id TEXT,
  project_id TEXT, source_scope TEXT NOT NULL, source_record_type TEXT NOT NULL,
  buildertrend_job_id TEXT, buildertrend_lead_id TEXT,
  buildertrend_record_id TEXT, buildertrend_record_number TEXT,
  buildertrend_url TEXT, title TEXT NOT NULL, record_date TEXT,
  record_status TEXT, source_status TEXT, department_code TEXT,
  client_name TEXT, contact_name TEXT, contact_email TEXT, amount REAL,
  searchable_text TEXT, normalized_summary TEXT, raw_payload_json TEXT,
  archive_drive_folder_id TEXT, archive_drive_file_id TEXT,
  archive_drive_url TEXT, review_status TEXT NOT NULL,
  promotion_status TEXT NOT NULL, promoted_record_type TEXT,
  promoted_record_id TEXT, sage_reconciliation_status TEXT NOT NULL,
  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE buildertrend_archive_files (
  id TEXT PRIMARY KEY, import_run_id TEXT NOT NULL, source_record_id TEXT,
  organization_id TEXT, project_id TEXT, source_scope TEXT NOT NULL,
  source_record_type TEXT NOT NULL, buildertrend_job_id TEXT,
  buildertrend_lead_id TEXT, buildertrend_file_id TEXT, buildertrend_url TEXT,
  file_name TEXT NOT NULL, mime_type TEXT, file_size INTEGER,
  drive_folder_id TEXT, drive_file_id TEXT, drive_url TEXT,
  thumbnail_drive_file_id TEXT, thumbnail_url TEXT, checksum TEXT,
  captured_at TEXT, visibility TEXT NOT NULL, review_status TEXT NOT NULL,
  metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE buildertrend_access_candidates (
  id TEXT PRIMARY KEY, import_run_id TEXT NOT NULL, source_record_id TEXT,
  organization_id TEXT, project_id TEXT, buildertrend_job_id TEXT,
  buildertrend_lead_id TEXT, buildertrend_contact_id TEXT,
  buildertrend_access_role TEXT, contact_name TEXT NOT NULL, company_name TEXT,
  email TEXT, phone TEXT, proposed_contact_type TEXT NOT NULL,
  proposed_project_role TEXT, matched_user_id TEXT, matched_customer_id TEXT,
  matched_vendor_id TEXT, match_status TEXT NOT NULL,
  match_confidence REAL NOT NULL, portal_access_status TEXT NOT NULL,
  review_status TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

function scalar(database: TestDatabase, sql: string): unknown {
  const row = database.prepare(sql).get()
  if (row === null || typeof row !== "object") return undefined
  return Object.values(row)[0]
}

function executeReconciliation(database: TestDatabase, sql: string): void {
  for (const statement of sql.split(";\n")) {
    const trimmed = statement.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith("SELECT ")) {
      database.prepare(trimmed).get()
      continue
    }
    database.exec(trimmed)
  }
}

describe("legacy Buildertrend staging reconciliation", () => {
  let database: TestDatabase

  beforeEach(async () => {
    database = await createDatabase()
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE organizations (id TEXT PRIMARY KEY);
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE customers (id TEXT PRIMARY KEY);
      CREATE TABLE vendors (id TEXT PRIMARY KEY);
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id)
      );
      INSERT INTO organizations (id) VALUES ('org-main'), ('org-other');
      INSERT INTO projects (id, organization_id)
      VALUES ('project-main', 'org-main'), ('project-other', 'org-other');
    `)
    database.exec(legacySchemaSql)
    database.exec(guardedMigrationSql)
    database.exec(`
      INSERT INTO buildertrend_import_runs VALUES
        ('run-shared', NULL, 'browser_capture', 'Shared capture', 'completed',
         NULL, '2026-07-01T00:00:00Z', '2026-07-01T01:00:00Z', NULL, NULL,
         'legacy notes', '{}', '2026-07-01T00:00:00Z', '2026-07-01T01:00:00Z'),
        ('run-orphan', NULL, 'browser_capture', 'Orphan capture', 'completed',
         NULL, '2026-07-02T00:00:00Z', '2026-07-02T01:00:00Z', NULL, NULL,
         NULL, '{}', '2026-07-02T00:00:00Z', '2026-07-02T01:00:00Z');
      INSERT INTO buildertrend_source_records VALUES
        ('record-main', 'run-shared', NULL, 'project-main', 'job', 'schedule',
         'job-main', NULL, 'source-main', NULL, NULL, 'Main schedule', NULL,
         NULL, NULL, 'O', NULL, NULL, NULL, NULL, NULL, NULL, '{}',
         'folder-main', 'file-main', 'https://drive.test/main', 'verified',
         'promoted', 'schedule_item', 'schedule-main', 'matched', NULL,
         '2026-07-01T00:00:00Z', '2026-07-01T01:00:00Z'),
        ('record-other', 'run-shared', NULL, 'project-other', 'job', 'job',
         'job-other', NULL, 'source-other', NULL, NULL, 'Other job', NULL,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}',
         NULL, NULL, NULL, 'needs_review', 'archive_only', NULL, NULL,
         'not_reviewed', NULL, '2026-07-01T00:00:00Z',
         '2026-07-01T01:00:00Z');
      INSERT INTO buildertrend_archive_files VALUES
        ('photo-main', 'run-shared', 'record-main', NULL, 'project-main', 'job',
         'photo', 'job-main', NULL, 'photo-1', NULL, 'photo.jpg', 'image/jpeg',
         100, 'folder-main', 'photo-drive', 'https://drive.test/photo', NULL,
         NULL, 'checksum-1', '2026-07-01T00:30:00Z', 'owner', 'verified', '{}',
         '2026-07-01T00:00:00Z', '2026-07-01T01:00:00Z');
      INSERT INTO buildertrend_access_candidates VALUES
        ('access-main', 'run-shared', 'record-main', NULL, 'project-main',
         'job-main', NULL, 'contact-1', 'owner', 'Example Owner', NULL,
         'owner@example.test', NULL, 'customer', 'owner', NULL, NULL, NULL,
         'matched', 0.95, 'granted', 'needs_review', NULL,
         '2026-07-01T00:00:00Z', '2026-07-01T01:00:00Z');
    `)
  })

  it("splits shared runs by tenant and preserves reviewed archive evidence", () => {
    const sql = buildLegacyBuildertrendReconciliationSql("org-main")
    executeReconciliation(database, sql)

    expect(scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_runs")).toBe(3)
    expect(scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_records")).toBe(2)
    expect(scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_files")).toBe(1)
    expect(
      scalar(database, "SELECT verified_drive_file_id FROM buildertrend_staging_files")
    ).toBe("photo-drive")
    expect(
      scalar(
        database,
        "SELECT verified_archive_drive_file_id FROM buildertrend_staging_records WHERE id = 'legacy-record:record-main'"
      )
    ).toBe("file-main")
    expect(scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_observations")).toBe(4)
  })

  it("never carries forward an implicit portal grant", () => {
    executeReconciliation(
      database,
      buildLegacyBuildertrendReconciliationSql("org-main")
    )

    expect(
      scalar(database, "SELECT portal_access_status FROM buildertrend_staging_access_candidates")
    ).toBe("not_granted")
    expect(
      scalar(database, "SELECT match_status FROM buildertrend_staging_access_candidates")
    ).toBe("unmatched")
  })

  it("is idempotent and does not overwrite guarded review decisions", () => {
    const sql = buildLegacyBuildertrendReconciliationSql("org-main")
    executeReconciliation(database, sql)
    database.exec(`
      UPDATE buildertrend_staging_records
      SET review_status = 'reviewed', review_notes = 'Human decision'
      WHERE id = 'legacy-record:record-main';
    `)
    executeReconciliation(database, sql)

    expect(scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_records")).toBe(2)
    expect(
      scalar(
        database,
        "SELECT review_notes FROM buildertrend_staging_records WHERE id = 'legacy-record:record-main'"
      )
    ).toBe("Human decision")
  })

  it("quarantines a legacy tenant conflict under the linked project's tenant", () => {
    database.exec(`
      DELETE FROM buildertrend_archive_files WHERE source_record_id = 'record-main';
      DELETE FROM buildertrend_access_candidates WHERE source_record_id = 'record-main';
      UPDATE buildertrend_source_records
      SET organization_id = 'org-other'
      WHERE id = 'record-main';
    `)
    expect(
      scalar(
        database,
        `SELECT COUNT(*)
         FROM buildertrend_source_records source_record
         JOIN projects project ON project.id = source_record.project_id
         WHERE source_record.organization_id IS NOT NULL
           AND source_record.organization_id <> project.organization_id`
      )
    ).toBe(1)

    executeReconciliation(
      database,
      buildLegacyBuildertrendReconciliationSql("org-main")
    )
    expect(
      scalar(
        database,
        "SELECT organization_id FROM buildertrend_staging_records WHERE id = 'legacy-record:record-main'"
      )
    ).toBe("org-main")
    expect(
      scalar(
        database,
        "SELECT review_status FROM buildertrend_staging_records WHERE id = 'legacy-record:record-main'"
      )
    ).toBe("unresolved_reference")
    expect(
      scalar(
        database,
        "SELECT promotion_status FROM buildertrend_staging_records WHERE id = 'legacy-record:record-main'"
      )
    ).toBe("archive_only")
  })

  it("aborts before durable writes when the selected tenant does not exist", () => {
    expect(() =>
      executeReconciliation(
        database,
        buildLegacyBuildertrendReconciliationSql("missing-organization")
      )
    ).toThrow()
    expect(scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_runs")).toBe(0)
    expect(scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_records")).toBe(0)
  })

  it("aborts when a file inherits a conflicting tenant through its source record", () => {
    database.exec(`
      UPDATE buildertrend_archive_files
      SET project_id = NULL, organization_id = 'org-other'
      WHERE id = 'photo-main';
    `)

    expect(() =>
      executeReconciliation(
        database,
        buildLegacyBuildertrendReconciliationSql("org-main")
      )
    ).toThrow()
    expect(scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_files")).toBe(0)
  })

  it("aborts when an access candidate links projects across tenants", () => {
    database.exec(`
      UPDATE buildertrend_access_candidates
      SET project_id = 'project-other'
      WHERE id = 'access-main';
    `)

    expect(() =>
      executeReconciliation(
        database,
        buildLegacyBuildertrendReconciliationSql("org-main")
      )
    ).toThrow()
    expect(
      scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_access_candidates")
    ).toBe(0)
  })
})
