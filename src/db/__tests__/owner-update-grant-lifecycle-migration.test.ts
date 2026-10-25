import { createRequire } from "node:module"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type SqliteStatement = Readonly<{
  readonly run: (...values: readonly unknown[]) => { readonly changes: number }
  readonly all: (...values: readonly unknown[]) => readonly unknown[]
}>

type Sqlite = Readonly<{
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => SqliteStatement
  readonly close: () => void
}>

type SqliteConstructor = new (file: string) => Sqlite

const nodeRequire = createRequire(import.meta.url)
const grantsMigrationPath = resolve(
  process.cwd(),
  "drizzle/0252_external_resource_grants.sql"
)
const publishAtomicityMigrationPath = resolve(
  process.cwd(),
  "drizzle/0253_owner_update_publish_attachment_atomicity.sql"
)
const lifecycleMigrationPath = resolve(
  process.cwd(),
  "drizzle/0254_owner_update_attachment_grant_lifecycle.sql"
)

function isSqliteConstructor(value: unknown): value is SqliteConstructor {
  return typeof value === "function"
}

function newSqlite(): Sqlite {
  const imported: unknown = nodeRequire("better-sqlite3")
  const constructor =
    typeof imported === "function"
      ? imported
      : imported !== null && typeof imported === "object"
        ? Reflect.get(imported, "default")
        : undefined
  if (!isSqliteConstructor(constructor)) {
    throw new Error("better-sqlite3 is required for the grant lifecycle regression")
  }
  return new constructor(":memory:")
}

function applyMigration(sqlite: Sqlite, path: string): void {
  for (const statement of readFileSync(path, "utf8").split(
    "--> statement-breakpoint"
  )) {
    if (statement.trim().length > 0) sqlite.exec(statement)
  }
}

function seedSchema(sqlite: Sqlite): void {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id)
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE organization_members (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL
    );
    CREATE TABLE project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL
    );
    CREATE TABLE owner_project_updates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      created_by TEXT REFERENCES users(id),
      status TEXT NOT NULL,
      selected_photo_ids TEXT,
      schedule_snapshot TEXT,
      updated_at TEXT NOT NULL,
      recalled_by TEXT REFERENCES users(id)
    );
    CREATE TABLE daily_log_photos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      mime_type TEXT,
      drive_file_id TEXT,
      thumbnail_url TEXT,
      review_status TEXT NOT NULL,
      owner_visible INTEGER NOT NULL,
      sub_vendor_visible INTEGER NOT NULL DEFAULT 0,
      public_shareable INTEGER NOT NULL DEFAULT 0,
      file_name TEXT NOT NULL DEFAULT 'shared-file',
      updated_at TEXT NOT NULL
    );
    INSERT INTO organizations VALUES ('org-1', 'client', 1);
    INSERT INTO projects VALUES ('project-1', 'org-1');
    INSERT INTO users VALUES
      ('staff-1', 'admin', 1),
      ('owner-1', 'client', 1);
    INSERT INTO organization_members VALUES
      ('org-member-staff', 'org-1', 'staff-1', 'admin', '2026-01-01T00:00:00.000Z'),
      ('org-member-owner', 'org-1', 'owner-1', 'client', '2026-01-01T00:00:00.000Z');
    INSERT INTO project_members VALUES ('member-1', 'project-1', 'owner-1', 'owner');
    INSERT INTO daily_log_photos
      (id, project_id, mime_type, drive_file_id, thumbnail_url, review_status, owner_visible, updated_at)
    VALUES
      ('photo-1', 'project-1', 'image/jpeg', 'drive-photo', NULL, 'approved', 1, '2026-07-28T14:00:00.000Z'),
      ('document-1', 'project-1', 'application/pdf', 'drive-document', 'https://drive.google.com/document-thumbnail', 'approved', 1, '2026-07-28T14:00:00.000Z'),
      ('document-null-mime', 'project-1', NULL, 'drive-null-document', NULL, 'approved', 1, '2026-07-28T14:00:00.000Z'),
      ('photo-null-mime', 'project-1', NULL, 'drive-null-photo', 'https://drive.google.com/photo-thumbnail', 'approved', 1, '2026-07-28T14:00:00.000Z'),
      ('photo-scalar', 'project-1', 'image/jpeg', 'drive-scalar', NULL, 'pending', 0, '2026-07-28T14:00:00.000Z');
    INSERT INTO owner_project_updates
      (id, project_id, created_by, status, selected_photo_ids, schedule_snapshot, updated_at)
    VALUES (
      'published-1',
      'project-1',
      'staff-1',
      'published',
      '["photo-1","photo-null-mime"]',
      '{"version":2,"completedScheduleItems":[],"lookAheadScheduleItems":[],"todos":[],"documents":[{"id":"document-1","fileName":"plans.pdf","mimeType":"application/pdf","driveFileId":"drive-document","driveUrl":null,"caption":null,"capturedAt":null,"sourceSystem":"compass"},{"id":"document-null-mime","fileName":"legacy-document","mimeType":null,"driveFileId":"drive-null-document","driveUrl":null,"caption":null,"capturedAt":null,"sourceSystem":"compass"}]}',
      '2026-07-28T14:00:00.000Z'
    );
    INSERT INTO owner_project_updates
      (id, project_id, created_by, status, selected_photo_ids, schedule_snapshot, updated_at)
    VALUES (
      'published-malformed',
      'project-1',
      'staff-1',
      'published',
      '[broken',
      '{broken',
      '2026-07-28T14:00:00.000Z'
    );
    INSERT INTO owner_project_updates
      (id, project_id, created_by, status, selected_photo_ids, schedule_snapshot, updated_at)
    VALUES
      (
        'published-null-actor',
        'project-1',
        NULL,
        'published',
        '["photo-1"]',
        '{"version":2,"documents":[]}',
        '2026-07-28T14:00:00.000Z'
      ),
      (
        'published-scalar-selection',
        'project-1',
        'staff-1',
        'published',
        '"photo-scalar"',
        '{"version":2,"documents":["document-1"]}',
        '2026-07-28T14:00:00.000Z'
      ),
      (
        'published-invalid-document-shape',
        'project-1',
        'staff-1',
        'published',
        '[]',
        '{"version":2,"completedScheduleItems":[],"lookAheadScheduleItems":[],"todos":[],"documents":[{"id":"document-1","fileName":"plans.pdf","mimeType":"application/pdf","driveFileId":"drive-document","driveUrl":null,"caption":null,"capturedAt":null,"sourceSystem":"compass"},{"id":"document-null-mime"}]}',
        '2026-07-28T14:00:00.000Z'
      ),
      (
        'published-invalid-schedule-shape',
        'project-1',
        'staff-1',
        'published',
        '[]',
        '{"version":2,"completedScheduleItems":[{"id":"schedule-1"}],"lookAheadScheduleItems":[],"todos":[],"documents":[{"id":"document-1","fileName":"plans.pdf","mimeType":"application/pdf","driveFileId":"drive-document","driveUrl":null,"caption":null,"capturedAt":null,"sourceSystem":"compass"}]}',
        '2026-07-28T14:00:00.000Z'
      );
  `)
}

describe("owner-update attachment grant lifecycle migration", () => {
  it("backfills publication grants and revokes them in the recall statement", () => {
    expect(existsSync(lifecycleMigrationPath)).toBe(true)
    const sqlite = newSqlite()
    try {
      seedSchema(sqlite)
      applyMigration(sqlite, grantsMigrationPath)
      applyMigration(sqlite, publishAtomicityMigrationPath)
      applyMigration(sqlite, lifecycleMigrationPath)

      expect(
        sqlite
          .prepare(
            `SELECT resource_type, resource_id, source_owner_update_id,
                    recipient_user_id, revoked_at
             FROM project_external_resource_grants
             WHERE source_owner_update_id = 'published-1'
             ORDER BY resource_type, resource_id`
          )
          .all()
      ).toEqual([
        {
          resource_type: "owner_update_document",
          resource_id: "document-1",
          source_owner_update_id: "published-1",
          recipient_user_id: "owner-1",
          revoked_at: null,
        },
        {
          resource_type: "owner_update_document",
          resource_id: "document-null-mime",
          source_owner_update_id: "published-1",
          recipient_user_id: "owner-1",
          revoked_at: null,
        },
        {
          resource_type: "photo",
          resource_id: "photo-1",
          source_owner_update_id: "published-1",
          recipient_user_id: "owner-1",
          revoked_at: null,
        },
        {
          resource_type: "photo",
          resource_id: "photo-null-mime",
          source_owner_update_id: "published-1",
          recipient_user_id: "owner-1",
          revoked_at: null,
        },
      ])

      expect(
        sqlite
          .prepare(
            `SELECT resource_id, granted_by
             FROM project_external_resource_grants
             WHERE source_owner_update_id = ?`
          )
          .all("published-null-actor")
      ).toEqual([{ resource_id: "photo-1", granted_by: "staff-1" }])
      expect(
        sqlite
          .prepare(
            `SELECT resource_id
             FROM project_external_resource_grants
             WHERE source_owner_update_id = ?`
          )
          .all("published-scalar-selection")
      ).toEqual([])
      expect(
        sqlite
          .prepare(
            `SELECT resource_id
             FROM project_external_resource_grants
             WHERE source_owner_update_id IN (?, ?)
             ORDER BY source_owner_update_id, resource_id`
          )
          .all(
            "published-invalid-document-shape",
            "published-invalid-schedule-shape"
          )
      ).toEqual([])
      expect(
        sqlite
          .prepare(
            `SELECT review_status, owner_visible
             FROM daily_log_photos
             WHERE id = ?`
          )
          .all("photo-scalar")
      ).toEqual([{ review_status: "pending", owner_visible: 0 }])

      sqlite
        .prepare(
          `INSERT INTO owner_project_updates
             (id, project_id, created_by, status, selected_photo_ids,
              schedule_snapshot, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?)`
        )
        .run(
          "draft-malformed",
          "project-1",
          "staff-1",
          "[broken",
          "{broken",
          "2026-07-28T14:00:00.000Z"
        )
      expect(() =>
        sqlite
          .prepare(
            `UPDATE owner_project_updates
             SET status = 'published', updated_at = ?
             WHERE id = ? AND status = 'draft'`
          )
          .run("2026-07-28T15:00:00.000Z", "draft-malformed")
      ).not.toThrow()
      expect(
        sqlite
          .prepare(
            `SELECT resource_id
             FROM project_external_resource_grants
             WHERE source_owner_update_id = ?`
          )
          .all("draft-malformed")
      ).toEqual([])

      sqlite
        .prepare(
          `UPDATE owner_project_updates
           SET status = 'draft', recalled_by = 'staff-1', updated_at = ?
           WHERE id = ? AND status = 'published'`
        )
        .run("2026-07-29T12:00:00.000Z", "published-1")

      expect(
        sqlite
          .prepare(
            `SELECT DISTINCT revoked_by, revoked_at
             FROM project_external_resource_grants
             WHERE source_owner_update_id = ?`
          )
          .all("published-1")
      ).toEqual([
        {
          revoked_by: "staff-1",
          revoked_at: "2026-07-29T12:00:00.000Z",
        },
      ])
    } finally {
      sqlite.close()
    }
  })
})
