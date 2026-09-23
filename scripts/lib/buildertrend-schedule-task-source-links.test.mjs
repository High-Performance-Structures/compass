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
    "CREATE TABLE projects (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id));",
    "CREATE TABLE schedule_tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE);",
    "CREATE TABLE buildertrend_staging_records (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), project_id TEXT REFERENCES projects(id), source_key TEXT, buildertrend_job_id TEXT, source_record_type TEXT NOT NULL, promotion_status TEXT NOT NULL, promoted_record_type TEXT, promoted_record_id TEXT);",
  ].join("\n"))
  db.exec(migration)
  db.exec([
    "INSERT INTO organizations VALUES ('org-1'), ('org-2');",
    "INSERT INTO projects VALUES ('project-1', 'org-1'), ('project-2', 'org-2');",
    "INSERT INTO schedule_tasks VALUES ('task-1', 'project-1'), ('task-2', 'project-2');",
    "INSERT INTO buildertrend_staging_records VALUES ('source-1', 'org-1', 'project-1', 'job:45847565:schedule_item:1001', '45847565', 'schedule_item', 'promoted', 'schedule_task', 'task-1'), ('source-2', 'org-2', 'project-2', 'job:45847565:schedule_task:1002', '45847565', 'schedule_task', 'promoted', 'schedule_task', 'task-2');",
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

describe("Buildertrend schedule task source links", () => {
  it("replays the generated import link against the same verified source and task", () => {
    const db = newDatabase()
    try {
      const generated = generateBuildertrendScheduleRefreshSql({
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
      })
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

      db.prepare("DELETE FROM schedule_tasks WHERE id='task-1'").run()
      const tombstone = db.prepare(
        "SELECT source_record_id, schedule_task_id, schedule_task_id_snapshot, target_deleted_at FROM buildertrend_schedule_task_source_links WHERE id='link-1'"
      ).get()
      expect(tombstone.source_record_id).toBe("source-1")
      expect(tombstone.schedule_task_id).toBeNull()
      expect(tombstone.schedule_task_id_snapshot).toBe("task-1")
      expect(tombstone.target_deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
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
