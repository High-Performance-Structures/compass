import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { generateBuildertrendScheduleRefreshSql } from "./buildertrend-schedule-refresh.mjs"

const require = createRequire(import.meta.url)
const migration = readFileSync(
  new URL("../../drizzle/0164_buildertrend_schedule_task_source_links.sql", import.meta.url),
  "utf8",
)

function newDatabase() {
  let Database
  try {
    Database = require("better-sqlite3")
    const probe = new Database(":memory:")
    probe.close()
  } catch {
    Database = require("bun:sqlite").Database
  }
  const db = new Database(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  db.exec([
    "CREATE TABLE organizations (id TEXT PRIMARY KEY);",
    "CREATE TABLE projects (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), project_number TEXT, buildertrend_project_id TEXT, updated_at TEXT);",
    "CREATE TABLE schedule_tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT, start_date TEXT, workdays INTEGER, end_date_calculated TEXT, phase TEXT, status TEXT, percent_complete INTEGER, sort_order INTEGER, updated_at TEXT);",
    "CREATE TABLE task_dependencies (id TEXT PRIMARY KEY, predecessor_id TEXT REFERENCES schedule_tasks(id), successor_id TEXT REFERENCES schedule_tasks(id), type TEXT, lag_days INTEGER);",
    "CREATE TABLE buildertrend_staging_runs (id TEXT PRIMARY KEY, organization_id TEXT REFERENCES organizations(id), run_key TEXT, manifest_fingerprint TEXT, source_method TEXT, source_label TEXT, status TEXT, started_by TEXT, started_at TEXT, completed_at TEXT, raw_artifact_drive_file_id TEXT, raw_artifact_drive_url TEXT, source_notes TEXT, summary_json TEXT, created_at TEXT, updated_at TEXT, UNIQUE (organization_id, run_key));",
    "CREATE TABLE buildertrend_staging_records (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), source_key TEXT, requested_project_id TEXT, project_id TEXT REFERENCES projects(id), source_scope TEXT, source_record_type TEXT NOT NULL, buildertrend_job_id TEXT, buildertrend_lead_id TEXT, buildertrend_record_id TEXT, buildertrend_record_number TEXT, buildertrend_url TEXT, title TEXT, record_date TEXT, record_status TEXT, source_status TEXT, department_code TEXT, client_name TEXT, contact_name TEXT, contact_email TEXT, amount REAL, searchable_text TEXT, normalized_summary TEXT, raw_payload_json TEXT, source_archive_drive_folder_id TEXT, source_archive_drive_file_id TEXT, source_archive_drive_url TEXT, verified_archive_drive_folder_id TEXT, verified_archive_drive_file_id TEXT, verified_archive_drive_url TEXT, review_status TEXT, promotion_status TEXT NOT NULL, promoted_record_type TEXT, promoted_record_id TEXT, sage_reconciliation_status TEXT, source_notes TEXT, review_notes TEXT, created_at TEXT, updated_at TEXT, UNIQUE (organization_id, source_key));",
    "CREATE TABLE buildertrend_staging_observations (id TEXT PRIMARY KEY, import_run_id TEXT REFERENCES buildertrend_staging_runs(id), organization_id TEXT, entity_kind TEXT, entity_key TEXT, entity_id TEXT, observed_payload_json TEXT, observed_at TEXT);",
  ].join("\n"))
  db.exec(migration)
  db.exec([
    "INSERT INTO organizations VALUES ('org-1'), ('org-2');",
    "INSERT INTO projects (id, organization_id, project_number) VALUES ('project-1', 'org-1', 'H-430-1900'), ('project-2', 'org-2', 'H-999-9999');",
    "INSERT INTO schedule_tasks (id, project_id, title) VALUES ('task-1', 'project-1', 'Foundation'), ('task-2', 'project-2', 'Other');",
    "INSERT INTO buildertrend_staging_records (id, organization_id, project_id, source_key, buildertrend_job_id, source_record_type, promotion_status, promoted_record_type, promoted_record_id) VALUES ('source-1', 'org-1', 'project-1', 'job:45847565:schedule_item:1001', '45847565', 'schedule_item', 'promoted', 'schedule_task', 'task-1'), ('source-2', 'org-2', 'project-2', 'job:45847565:schedule_task:1002', '45847565', 'schedule_task', 'promoted', 'schedule_task', 'task-2');",
  ].join("\n"))
  return db
}

function insertLink(db, overrides = {}) {
  const row = {
    id: "link-1",
    organizationId: "org-1",
    projectId: "project-1",
    sourceRecordId: "source-1",
    taskId: "task-1",
    taskSnapshot: "task-1",
    ...overrides,
  }
  db.prepare(
    "INSERT INTO buildertrend_schedule_task_source_links (id, organization_id, project_id, source_record_id, schedule_task_id, schedule_task_id_snapshot, linked_at) VALUES (?, ?, ?, ?, ?, ?, '2026-09-22T00:00:00Z')"
  ).run(
    row.id, row.organizationId, row.projectId, row.sourceRecordId,
    row.taskId, row.taskSnapshot,
  )
}

function oneItemFixture() {
  return {
    organizationId: "org-1",
    projectId: "project-1",
    projectNumber: "H-430-1900",
    buildertrendJobId: "45847565",
    capturedAt: "2026-09-22T00:00:00Z",
    sourceLabel: "Authenticated schedule capture",
    replaceAllDependencies: true,
    items: [{
      sourceHref: "/app/Schedules/5/Schedule/1001/45847565",
      sourceRecordId: "1001",
      compassTaskId: "task-1",
      sortOrder: 1,
      title: "Foundation",
      phase: "Structure",
      complete: false,
      start: "Sep 22, 2026",
      duration: 1,
      end: "Sep 22, 2026",
      percent: 0,
      predecessors: [],
    }],
  }
}

describe("Buildertrend schedule task source links", () => {
  it("replays the generated import link against the same verified source and task", () => {
    const db = newDatabase()
    try {
      const generated = generateBuildertrendScheduleRefreshSql(oneItemFixture())
      const linkSql = generated.split("\n").find((line) =>
        line.startsWith("INSERT INTO buildertrend_schedule_task_source_links")
      )
      expect(linkSql).toBeDefined()
      db.exec(linkSql)
      db.exec(linkSql)
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM buildertrend_schedule_task_source_links").get().n
      ).toBe(1)
    } finally {
      db.close()
    }
  })

  it("executes the entire refresh, verifies its links, and never recreates a deleted task", () => {
    const db = newDatabase()
    try {
      const generated = generateBuildertrendScheduleRefreshSql(oneItemFixture())
      const apply = () => {
        db.exec("BEGIN")
        try {
          for (const statement of generated.split("\n").filter(Boolean)) {
            db.exec(statement)
          }
          db.exec("COMMIT")
        } catch (error) {
          db.exec("ROLLBACK")
          throw error
        }
      }
      apply()
      apply()
      expect(db.prepare("SELECT COUNT(*) AS n FROM buildertrend_schedule_task_source_links").get().n).toBe(1)
      expect(db.prepare("SELECT promotion_status FROM buildertrend_staging_records WHERE id='source-1'").get().promotion_status).toBe("promoted")
      db.prepare("DELETE FROM schedule_tasks WHERE id='task-1'").run()
      const source = db.prepare(
        "SELECT promotion_status, promoted_record_id FROM buildertrend_staging_records WHERE id='source-1'"
      ).get()
      expect(source.promotion_status).toBe("archive_only")
      expect(source.promoted_record_id).toBe("task-1")
      expect(db.prepare("SELECT COUNT(*) AS n FROM schedule_tasks WHERE project_id='project-1'").get().n).toBe(0)
      expect(() => db.exec(generated.split("\n")[0])).toThrow()
      expect(() => apply()).toThrow()
      expect(db.prepare("SELECT COUNT(*) AS n FROM schedule_tasks WHERE id='task-1'").get().n).toBe(0)
      expect(db.prepare("SELECT promotion_status FROM buildertrend_staging_records WHERE id='source-1'").get().promotion_status).toBe("archive_only")
      expect(db.prepare("SELECT COUNT(*) AS n FROM buildertrend_staging_runs").get().n).toBe(1)
    } finally {
      db.close()
    }
  })

  it("keeps an exact pair across replay and task deletion", () => {
    const db = newDatabase()
    try {
      insertLink(db)
      expect(() => insertLink(db, { id: "link-replay" })).toThrow()
      expect(() =>
        db.prepare("UPDATE schedule_tasks SET project_id='project-2' WHERE id='task-1'").run()
      ).toThrow()
      expect(() =>
        db.prepare("UPDATE buildertrend_staging_records SET project_id='project-2' WHERE id='source-1'").run()
      ).toThrow()
      expect(() =>
        db.prepare("UPDATE projects SET organization_id='org-2' WHERE id='project-1'").run()
      ).toThrow()
      expect(() =>
        db.prepare("DELETE FROM buildertrend_schedule_task_source_links WHERE id='link-1'").run()
      ).toThrow()

      db.prepare(
        "UPDATE buildertrend_staging_records SET review_notes='Reviewed and approved by staff' WHERE id='source-1'"
      ).run()
      db.prepare("DELETE FROM schedule_tasks WHERE id='task-1'").run()
      const tombstone = db.prepare(
        "SELECT source_record_id, schedule_task_id, schedule_task_id_snapshot, target_deleted_at FROM buildertrend_schedule_task_source_links WHERE id='link-1'"
      ).get()
      expect(tombstone.source_record_id).toBe("source-1")
      expect(tombstone.schedule_task_id).toBeNull()
      expect(tombstone.schedule_task_id_snapshot).toBe("task-1")
      expect(tombstone.target_deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      const archivedSource = db.prepare(
        "SELECT promotion_status, promoted_record_id, review_notes FROM buildertrend_staging_records WHERE id='source-1'"
      ).get()
      expect(archivedSource.promotion_status).toBe("archive_only")
      expect(archivedSource.promoted_record_id).toBe("task-1")
      expect(archivedSource.review_notes).toBe("Reviewed and approved by staff")
      expect(() =>
        db.prepare("UPDATE buildertrend_staging_records SET project_id='project-2' WHERE id='source-1'").run()
      ).toThrow()
      expect(() =>
        db.prepare("UPDATE buildertrend_staging_records SET promotion_status='promoted' WHERE id='source-1'").run()
      ).toThrow()
      expect(() =>
        db.prepare("DELETE FROM buildertrend_staging_records WHERE id='source-1'").run()
      ).toThrow()
    } finally {
      db.close()
    }
  })

  it("rejects wrong tenant, wrong project, and a mismatched target snapshot", () => {
    const db = newDatabase()
    try {
      expect(() => insertLink(db, { organizationId: "org-2" })).toThrow()
      expect(() => insertLink(db, { projectId: "project-2" })).toThrow()
      expect(() => insertLink(db, { taskSnapshot: "other-task" })).toThrow()
      expect(() => insertLink(db, { sourceRecordId: "source-2" })).toThrow()
      expect(db.prepare("SELECT COUNT(*) AS n FROM buildertrend_schedule_task_source_links").get().n).toBe(0)
    } finally {
      db.close()
    }
  })
})
