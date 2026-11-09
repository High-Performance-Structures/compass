import { readFileSync } from "node:fs"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

const MIGRATION = readFileSync(new URL("../../../drizzle/0311_selection_choices_foundations.sql", import.meta.url), "utf8")

function apply(db: InstanceType<typeof Database>): void {
  for (const statement of MIGRATION.split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement)
  }
}

function fixture(): InstanceType<typeof Database> {
  const db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE vendors (id TEXT PRIMARY KEY);
    CREATE TABLE daily_log_photos (id TEXT PRIMARY KEY);
    CREATE TABLE project_finish_selections (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_system TEXT NOT NULL DEFAULT 'compass',
      choice_options_json TEXT, color_finish TEXT, parent_selection_id TEXT, parent_choice_value TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO projects VALUES ('p1');
    INSERT INTO project_finish_selections VALUES
      ('vanity', 'p1', 'buildertrend', '["Oak 36in", " Walnut 48in ", "", 7, "Oak 36in"]', 'Oak 36in', NULL, NULL, '2026-07-01', '2026-07-02'),
      ('hardware', 'p1', 'buildertrend', '["Brass","Nickel"]', NULL, 'vanity', 'Walnut 48in', '2026-07-01', '2026-07-01'),
      ('broken', 'p1', 'compass', 'not json', 'x', NULL, NULL, '2026-07-01', '2026-07-01'),
      ('object', 'p1', 'compass', '{"a":"b"}', NULL, NULL, NULL, '2026-07-01', '2026-07-01'),
      ('orphan', 'p1', 'compass', NULL, NULL, 'vanity', 'Pine', '2026-07-01', '2026-07-01');
  `)
  apply(db)
  return db
}

describe("0311 selection choices foundations", () => {
  it("backfills one choice row per text option, in order, with the matching option chosen once", () => {
    const db = fixture()
    try {
      const rows = db.prepare("SELECT id, title, sort_order, chosen, source_system FROM project_selection_choices WHERE selection_id = 'vanity' ORDER BY sort_order").all()
      expect(rows).toEqual([
        { id: "psc_vanity_0", title: "Oak 36in", sort_order: 0, chosen: 1, source_system: "buildertrend" },
        { id: "psc_vanity_1", title: "Walnut 48in", sort_order: 1, chosen: 0, source_system: "buildertrend" },
        { id: "psc_vanity_4", title: "Oak 36in", sort_order: 4, chosen: 0, source_system: "buildertrend" },
      ])
      expect(db.prepare("SELECT count(*) AS n FROM project_selection_choices WHERE selection_id IN ('broken', 'object')").get()).toEqual({ n: 0 })
    } finally { db.close() }
  })

  it("links a child selection to the parent choice it names", () => {
    const db = fixture()
    try {
      expect(db.prepare("SELECT choice_id, selection_id FROM project_selection_choice_dependents").all()).toEqual([
        { choice_id: "psc_vanity_1", selection_id: "hardware" },
      ])
    } finally { db.close() }
  })

  it("adds nothing when run again", () => {
    const db = fixture()
    try {
      apply(db)
      expect(db.prepare("SELECT count(*) AS n FROM project_selection_choices").get()).toEqual({ n: 5 })
      expect(db.prepare("SELECT count(*) AS n FROM project_selection_choice_dependents").get()).toEqual({ n: 1 })
    } finally { db.close() }
  })

  it("allows one chosen choice per selection and one row per Buildertrend choice", () => {
    const db = fixture()
    try {
      expect(() => db.prepare("UPDATE project_selection_choices SET chosen = 1 WHERE id = 'psc_vanity_1'").run()).toThrow()
      const insert = db.prepare(`INSERT INTO project_selection_choices (id, project_id, selection_id, title, source_system, bt_choice_id, created_at, updated_at)
        VALUES (?, 'p1', 'hardware', 'Bronze', 'buildertrend', 'bt-9', '2026-11-09', '2026-11-09')`)
      insert.run("c-a")
      expect(() => insert.run("c-b")).toThrow()
    } finally { db.close() }
  })

  it("removes a selection's rows with the selection", () => {
    const db = fixture()
    try {
      db.exec(`INSERT INTO project_selection_comments (id, project_id, selection_id, body, created_at, updated_at)
        VALUES ('m1', 'p1', 'vanity', 'Owner prefers walnut', '2026-11-09', '2026-11-09')`)
      db.exec("DELETE FROM project_finish_selections WHERE id = 'vanity'")
      expect(db.prepare("SELECT count(*) AS n FROM project_selection_choices WHERE selection_id = 'vanity'").get()).toEqual({ n: 0 })
      expect(db.prepare("SELECT count(*) AS n FROM project_selection_comments").get()).toEqual({ n: 0 })
      expect(db.prepare("SELECT count(*) AS n FROM project_selection_choice_dependents").get()).toEqual({ n: 0 })
    } finally { db.close() }
  })
})
