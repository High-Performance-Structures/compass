import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildBuildertrendStagingSql,
  parseBuildertrendStagingManifest,
} from "../staging-manifest"

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0084_buildertrend_staging_foundation.sql"),
  "utf8"
).replaceAll("--> statement-breakpoint", "")

const manifestInput = {
  runKey: "jobs-2026-07-30",
  sourceMethod: "authenticated_export",
  sourceLabel: "Buildertrend job inventory",
  capturedAt: "2026-07-30T12:00:00.000Z",
  records: [
    {
      sourceKey: "job:123",
      projectId: "project-123",
      sourceRecordType: "job",
      buildertrendJobId: "123",
      buildertrendRecordId: "123",
      title: "Example project",
      rawPayload: { status: "Open" },
      archiveDriveFolderId: "source-record-folder",
      archiveDriveFileId: "source-record-drive",
      archiveDriveUrl: "https://source.example/record",
    },
  ],
  files: [
    {
      sourceKey: "file:123:photo-1",
      sourceRecordKey: "job:123",
      projectId: "project-123",
      sourceRecordType: "job_photo",
      buildertrendJobId: "123",
      buildertrendFileId: "photo-1",
      fileName: "photo-1.jpg",
      checksum: "abc123",
      driveFolderId: "source-file-folder",
      driveFileId: "source-file-drive",
      driveUrl: "https://source.example/file",
      thumbnailDriveFileId: "source-thumbnail-drive",
      thumbnailUrl: "https://source.example/thumbnail",
    },
  ],
  accessCandidates: [
    {
      sourceKey: "access:123:contact-1",
      sourceRecordKey: "job:123",
      projectId: "project-123",
      buildertrendJobId: "123",
      buildertrendContactId: "contact-1",
      buildertrendAccessRole: "client",
      contactName: "Example Owner",
      email: "approved@example.test",
      proposedContactType: "customer",
    },
  ],
}

type TestStatement = {
  readonly get: () => unknown
  readonly run: () => unknown
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
  const database = new Database(":memory:")
  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => {
      const statement = database.prepare(sql)
      return {
        get: () => statement.get(),
        run: () => statement.run(),
      }
    },
    close: () => database.close(),
  }
}

async function createTestDb(): Promise<TestDatabase> {
  const database = await createDatabase()
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
  `)
  database.exec(migrationSql)
  database.exec(`
    INSERT INTO organizations (id) VALUES ('org-example'), ('org-other');
    INSERT INTO projects (id, organization_id)
      VALUES
        ('project-123', 'org-example'),
        ('project-other', 'org-example'),
        ('project-cross-org', 'org-other');
  `)
  return database
}

function parsedManifest(value: unknown) {
  const result = parseBuildertrendStagingManifest(value)
  if (!result.success) throw new Error(result.errors.join("\n"))
  return result.data
}

function scalar(
  database: TestDatabase,
  sql: string
): unknown {
  const row: unknown = database.prepare(sql).get()
  if (row === null || typeof row !== "object") return row
  return Object.values(row)[0]
}

describe("Buildertrend staging manifest", () => {
  let database: TestDatabase

  beforeEach(async () => {
    database = await createTestDb()
  })

  afterEach(() => {
    if (database) database.close()
  })

  it("parses normalized manifests and rejects duplicate or inconsistent keys", () => {
    expect(parseBuildertrendStagingManifest(manifestInput).success).toBe(true)

    const duplicate = parseBuildertrendStagingManifest({
      ...manifestInput,
      records: [manifestInput.records[0], manifestInput.records[0]],
    })
    expect(duplicate).toEqual({
      success: false,
      errors: ['records contains duplicate sourceKey "job:123"'],
    })

    const mismatch = parseBuildertrendStagingManifest({
      ...manifestInput,
      files: [{ ...manifestInput.files[0], projectId: "project-other" }],
    })
    expect(mismatch).toEqual({
      success: false,
      errors: [
        'files.file:123:photo-1 projectId does not match source record "job:123"',
      ],
    })
  })

  it("generates deterministic SQL with explicit run finalization", async () => {
    const manifest = parsedManifest(manifestInput)
    const first = await buildBuildertrendStagingSql("org-example", manifest)
    const second = await buildBuildertrendStagingSql("org-example", manifest)

    expect(first.sql).toBe(second.sql)
    expect(first.statements[0]).toContain("'in_progress'")
    expect(first.statements.at(-1)).toContain("status = 'completed'")
    expect(first.summary).toEqual({
      runKey: "jobs-2026-07-30",
      sourceLabel: "Buildertrend job inventory",
      recordCount: 1,
      fileCount: 1,
      accessCandidateCount: 1,
    })
  })

  it("leaves an interrupted import visibly in progress", async () => {
    const build = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(manifestInput)
    )
    const firstStatement = build.statements[0]
    if (!firstStatement) throw new Error("Import start statement is missing")
    database.exec(firstStatement)

    expect(
      scalar(database, "SELECT status FROM buildertrend_staging_runs")
    ).toBe("in_progress")
    expect(
      scalar(database, "SELECT summary_json FROM buildertrend_staging_runs")
    ).toBeNull()
  })

  it("executes and replays without erasing reviewer decisions or evidence", async () => {
    const build = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(manifestInput)
    )
    database.exec(build.sql)
    database.exec(`
      UPDATE buildertrend_staging_records
      SET review_status = 'approved',
          promotion_status = 'promoted',
          promoted_record_id = 'manual-promoted',
          verified_archive_drive_file_id = 'manual-source-drive',
          review_notes = 'manual source note'
      WHERE source_key = 'job:123';
      UPDATE buildertrend_staging_files
      SET review_status = 'approved',
          visibility = 'owner',
          verified_drive_file_id = 'manual-file-drive',
          verified_drive_url = 'https://drive.example/file',
          verified_checksum = 'verified-checksum',
          review_metadata_json = '{"reviewer":"staff"}'
      WHERE source_key = 'file:123:photo-1';
      UPDATE buildertrend_staging_access_candidates
      SET review_status = 'approved',
          portal_access_status = 'granted',
          match_status = 'matched',
          review_notes = 'manual access note'
      WHERE source_key = 'access:123:contact-1';
    `)

    database.exec(build.sql)

    expect(
      scalar(
        database,
        "SELECT promotion_status FROM buildertrend_staging_records"
      )
    ).toBe("promoted")
    expect(
      scalar(
        database,
        "SELECT verified_archive_drive_file_id FROM buildertrend_staging_records"
      )
    ).toBe("manual-source-drive")
    expect(
      scalar(database, "SELECT review_notes FROM buildertrend_staging_records")
    ).toBe("manual source note")
    expect(
      scalar(
        database,
        "SELECT verified_drive_file_id FROM buildertrend_staging_files"
      )
    ).toBe("manual-file-drive")
    expect(
      scalar(
        database,
        "SELECT verified_checksum FROM buildertrend_staging_files"
      )
    ).toBe("verified-checksum")
    expect(
      scalar(
        database,
        "SELECT portal_access_status FROM buildertrend_staging_access_candidates"
      )
    ).toBe("granted")
    expect(
      scalar(
        database,
        "SELECT review_notes FROM buildertrend_staging_access_candidates"
      )
    ).toBe("manual access note")
    expect(
      scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_observations")
    ).toBe(3)
  })

  it("preserves project identity and quarantines changed references", async () => {
    const first = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(manifestInput)
    )
    database.exec(first.sql)
    database.exec(`
      UPDATE buildertrend_staging_records
        SET promotion_status = 'promoted', promoted_record_id = 'record-1';
      UPDATE buildertrend_staging_access_candidates
        SET portal_access_status = 'granted';
    `)

    const changed = {
      ...manifestInput,
      runKey: "changed-project-run",
      records: manifestInput.records.map((record) => ({
        ...record,
        projectId: "project-other",
      })),
      files: manifestInput.files.map((file) => ({
        ...file,
        projectId: "project-other",
      })),
      accessCandidates: manifestInput.accessCandidates.map((candidate) => ({
        ...candidate,
        projectId: "project-other",
      })),
    }
    const changedBuild = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(changed)
    )
    database.exec(changedBuild.sql)

    expect(
      scalar(database, "SELECT project_id FROM buildertrend_staging_records")
    ).toBe("project-123")
    expect(
      scalar(
        database,
        "SELECT review_status FROM buildertrend_staging_records"
      )
    ).toBe("reference_conflict")
    expect(
      scalar(
        database,
        "SELECT project_id FROM buildertrend_staging_access_candidates"
      )
    ).toBe("project-123")
    expect(
      scalar(
        database,
        "SELECT portal_access_status FROM buildertrend_staging_access_candidates"
      )
    ).toBe("granted")
  })

  it("rejects changed manifest membership for an existing run key", async () => {
    const first = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(manifestInput)
    )
    database.exec(first.sql)

    const changedMembership = {
      ...manifestInput,
      files: [],
      accessCandidates: [],
    }
    const replay = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(changedMembership)
    )
    database.exec(replay.sql)

    expect(
      scalar(database, "SELECT status FROM buildertrend_staging_runs")
    ).toBe("manifest_conflict")
    expect(
      scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_observations")
    ).toBe(3)
    expect(
      scalar(
        database,
        "SELECT json_extract(observed_payload_json, '$.sourceKey') FROM buildertrend_staging_observations WHERE entity_kind = 'file'"
      )
    ).toBe("file:123:photo-1")
  })

  it("preserves reviewed evidence pointers and quarantines source changes", async () => {
    const first = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(manifestInput)
    )
    database.exec(first.sql)
    database.exec(`
      UPDATE buildertrend_staging_records
      SET review_status = 'approved',
          verified_archive_drive_file_id = 'verified-record-drive';
      UPDATE buildertrend_staging_files
      SET review_status = 'approved',
          visibility = 'owner',
          verified_drive_file_id = 'verified-file-drive';
    `)

    const changedEvidence = {
      ...manifestInput,
      runKey: "changed-evidence-run",
      records: manifestInput.records.map((record) => ({
        ...record,
        archiveDriveFolderId: "different-source-record-folder",
      })),
      files: manifestInput.files.map((file) => ({
        ...file,
        driveFolderId: "different-source-file-folder",
        thumbnailUrl: "https://source.example/different-thumbnail",
      })),
    }
    const replay = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(changedEvidence)
    )
    database.exec(replay.sql)

    expect(
      scalar(
        database,
        "SELECT source_archive_drive_folder_id FROM buildertrend_staging_records"
      )
    ).toBe("source-record-folder")
    expect(
      scalar(
        database,
        "SELECT source_archive_drive_file_id FROM buildertrend_staging_records"
      )
    ).toBe("source-record-drive")
    expect(
      scalar(
        database,
        "SELECT verified_archive_drive_file_id FROM buildertrend_staging_records"
      )
    ).toBe("verified-record-drive")
    expect(
      scalar(
        database,
        "SELECT source_drive_folder_id FROM buildertrend_staging_files"
      )
    ).toBe("source-file-folder")
    expect(
      scalar(
        database,
        "SELECT source_drive_file_id FROM buildertrend_staging_files"
      )
    ).toBe("source-file-drive")
    expect(
      scalar(
        database,
        "SELECT source_thumbnail_url FROM buildertrend_staging_files"
      )
    ).toBe("https://source.example/thumbnail")
    expect(
      scalar(
        database,
        "SELECT verified_drive_file_id FROM buildertrend_staging_files"
      )
    ).toBe("verified-file-drive")
    expect(
      scalar(
        database,
        "SELECT review_status FROM buildertrend_staging_files"
      )
    ).toBe("evidence_conflict")
    expect(
      scalar(
        database,
        "SELECT json_extract(summary_json, '$.unresolvedOrConflicted') FROM buildertrend_staging_runs WHERE run_key = 'changed-evidence-run'"
      )
    ).toBe(2)
  })

  it("preserves a granted identity and quarantines identity changes", async () => {
    const first = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(manifestInput)
    )
    database.exec(first.sql)
    database.exec(`
      UPDATE buildertrend_staging_access_candidates
      SET review_status = 'approved',
          portal_access_status = 'granted',
          match_status = 'matched';
    `)

    const changedIdentity = {
      ...manifestInput,
      runKey: "changed-identity-run",
      accessCandidates: manifestInput.accessCandidates.map((candidate) => ({
        ...candidate,
        buildertrendContactId: "contact-2",
        contactName: "Different Person",
        email: "different@example.test",
      })),
    }
    const replay = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(changedIdentity)
    )
    database.exec(replay.sql)

    expect(
      scalar(
        database,
        "SELECT buildertrend_contact_id FROM buildertrend_staging_access_candidates"
      )
    ).toBe("contact-1")
    expect(
      scalar(
        database,
        "SELECT email FROM buildertrend_staging_access_candidates"
      )
    ).toBe("approved@example.test")
    expect(
      scalar(
        database,
        "SELECT portal_access_status FROM buildertrend_staging_access_candidates"
      )
    ).toBe("granted")
    expect(
      scalar(
        database,
        "SELECT review_status FROM buildertrend_staging_access_candidates"
      )
    ).toBe("identity_conflict")
  })

  it("quarantines children that conflict when an unresolved parent resolves", async () => {
    const unresolvedParent = {
      runKey: "unresolved-parent-run",
      sourceMethod: "authenticated_export",
      sourceLabel: "Unresolved parent",
      capturedAt: "2026-07-30T13:00:00.000Z",
      records: [
        {
          sourceKey: "job:late-parent",
          projectId: "project-cross-org",
          sourceRecordType: "job",
          title: "Late parent",
        },
      ],
      files: [],
      accessCandidates: [],
    }
    const first = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(unresolvedParent)
    )
    database.exec(first.sql)

    const child = {
      ...unresolvedParent,
      runKey: "child-run",
      sourceLabel: "Child before parent resolution",
      records: [],
      files: [
        {
          sourceKey: "file:late-parent",
          sourceRecordKey: "job:late-parent",
          projectId: "project-other",
          sourceRecordType: "job_photo",
          fileName: "late-parent.jpg",
        },
      ],
    }
    const second = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(child)
    )
    database.exec(second.sql)

    const resolvedParent = {
      ...unresolvedParent,
      runKey: "resolved-parent-run",
      sourceLabel: "Resolved parent",
      records: unresolvedParent.records.map((record) => ({
        ...record,
        projectId: "project-123",
      })),
    }
    const third = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(resolvedParent)
    )
    database.exec(third.sql)

    expect(
      scalar(
        database,
        "SELECT project_id FROM buildertrend_staging_records WHERE source_key = 'job:late-parent'"
      )
    ).toBe("project-123")
    expect(
      scalar(
        database,
        "SELECT review_status FROM buildertrend_staging_files WHERE source_key = 'file:late-parent'"
      )
    ).toBe("reference_conflict")
    expect(
      scalar(
        database,
        "SELECT json_extract(summary_json, '$.relationshipConflicts') FROM buildertrend_staging_runs WHERE run_key = 'resolved-parent-run'"
      )
    ).toBe(1)
  })

  it("quarantines unresolved cross-organization and missing references", async () => {
    const unresolved = {
      ...manifestInput,
      runKey: "unresolved-run",
      records: [
        {
          ...manifestInput.records[0],
          sourceKey: "job:cross-org",
          projectId: "project-cross-org",
        },
      ],
      files: [
        {
          ...manifestInput.files[0],
          sourceKey: "file:missing-parent",
          sourceRecordKey: "job:missing",
          projectId: "project-123",
        },
      ],
      accessCandidates: [],
    }
    const unresolvedBuild = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(unresolved)
    )
    database.exec(unresolvedBuild.sql)

    expect(
      scalar(
        database,
        "SELECT project_id FROM buildertrend_staging_records WHERE source_key = 'job:cross-org'"
      )
    ).toBeNull()
    expect(
      scalar(
        database,
        "SELECT review_status FROM buildertrend_staging_records WHERE source_key = 'job:cross-org'"
      )
    ).toBe("unresolved_reference")
    expect(
      scalar(
        database,
        "SELECT source_record_id FROM buildertrend_staging_files WHERE source_key = 'file:missing-parent'"
      )
    ).toBeNull()
    expect(
      scalar(
        database,
        "SELECT review_status FROM buildertrend_staging_files WHERE source_key = 'file:missing-parent'"
      )
    ).toBe("unresolved_reference")
    expect(
      scalar(
        database,
        "SELECT json_extract(summary_json, '$.unresolvedOrConflicted') FROM buildertrend_staging_runs WHERE run_key = 'unresolved-run'"
      )
    ).toBe(2)
  })

  it("retains immutable run observations and blocks destructive run deletion", async () => {
    const build = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(manifestInput)
    )
    database.exec(build.sql)

    expect(() =>
      database
        .prepare(
          "DELETE FROM buildertrend_staging_runs WHERE run_key = 'jobs-2026-07-30'"
        )
        .run()
    ).toThrow()
    expect(() =>
      database
        .prepare(
          "UPDATE buildertrend_staging_observations SET observed_payload_json = '{}'"
        )
        .run()
    ).toThrow()
    expect(() =>
      database.prepare("DELETE FROM buildertrend_staging_observations").run()
    ).toThrow()
    expect(() =>
      database
        .prepare(
          "UPDATE buildertrend_staging_files SET id = 'changed-file-id'"
        )
        .run()
    ).toThrow()
    expect(() =>
      database
        .prepare(
          "UPDATE buildertrend_staging_records SET id = 'changed-record-id'"
        )
        .run()
    ).toThrow()
    expect(() =>
      database
        .prepare(
          "UPDATE buildertrend_staging_access_candidates SET id = 'changed-access-id'"
        )
        .run()
    ).toThrow()
    expect(() =>
      database.prepare("DELETE FROM buildertrend_staging_files").run()
    ).toThrow()
    expect(() =>
      database
        .prepare("DELETE FROM buildertrend_staging_access_candidates")
        .run()
    ).toThrow()
    expect(
      scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_records")
    ).toBe(1)
    expect(
      scalar(database, "SELECT COUNT(*) FROM buildertrend_staging_files")
    ).toBe(1)
    expect(
      scalar(
        database,
        "SELECT COUNT(*) FROM buildertrend_staging_access_candidates"
      )
    ).toBe(1)
  })

  it("uses a table namespace that does not collide with abandoned staging", async () => {
    const collisionDatabase = await createDatabase()
    try {
      collisionDatabase.exec(`
        CREATE TABLE organizations (id TEXT PRIMARY KEY);
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE customers (id TEXT PRIMARY KEY);
        CREATE TABLE vendors (id TEXT PRIMARY KEY);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL
        );
        CREATE TABLE buildertrend_import_runs (id TEXT PRIMARY KEY);
      `)
      expect(() => collisionDatabase.exec(migrationSql)).not.toThrow()
    } finally {
      collisionDatabase.close()
    }
  })

  it("keeps operational side effects out of generated SQL", async () => {
    const build = await buildBuildertrendStagingSql(
      "org-example",
      parsedManifest(manifestInput)
    )
    const sql = build.sql

    expect(sql).not.toContain("INSERT INTO project_members")
    expect(sql).not.toContain("INSERT INTO notification_events")
    expect(sql).not.toContain("INSERT INTO project_budget_applications")
    expect(sql).not.toContain("INSERT INTO sage")
  })
})
