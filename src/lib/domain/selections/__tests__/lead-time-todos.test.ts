import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "@/test/migrated-database"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

import { loadLeadTimeContext, loadSelectionLeadTimeWarnings } from "@/lib/domain/selections/lead-time-read"
import { createLeadTimeTodos } from "@/lib/domain/selections/lead-time-todos"

/*
 * Selection lead-time warnings and the scheduled "Place long-lead order"
 * to-dos, against a database built from every migration: the Selection
 * Phase due date from the schedule, the company's warning window, one to-do
 * per selection and order-by date.
 */

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-09T12:00:00.000Z"
let sqlite: Sqlite
let migratedImage: Buffer | null = null

function migrated(): Sqlite {
  if (!migratedImage) {
    const db = new Database(":memory:")
    applyMigrations((sql) => db.exec(sql))
    migratedImage = db.serialize()
    db.close()
  }
  const copy = new Database(migratedImage)
  copy.exec("PRAGMA foreign_keys = ON")
  return copy
}

function choiceRow(id: string, selectionId: string, leadTimeDays: number | null, chosen = false): string {
  return `('${id}', 'p1', '${selectionId}', '${id}', ${leadTimeDays ?? "NULL"}, ${chosen ? 1 : 0}, '${NOW}', '${NOW}')`
}

beforeEach(() => {
  sqlite = migrated()
  // The Rough-in Selection Phase is due 21 days before Jan 29, 2027: Jan 8, 2027.
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES ('staff', 'pm@example.com', 'Pat PM', 'project_manager', 1, '${NOW}', '${NOW}');
    INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES ('m1', 'org-1', 'staff', 'project_manager', '${NOW}');
    INSERT INTO projects (id, name, organization_id, project_manager, created_at) VALUES ('p1', 'Job', 'org-1', 'Pat PM', '${NOW}');
    INSERT INTO project_finish_selections (id, project_id, room_name, name, category, status, round_key, created_at, updated_at) VALUES
      ('tile', 'p1', 'Kitchen', 'Backsplash', 'Tile', 'needed', 'rough-in', '${NOW}', '${NOW}'),
      ('tub', 'p1', 'Bath', 'Tub', 'Plumbing', 'ordered', 'rough-in', '${NOW}', '${NOW}'),
      ('faucet', 'p1', 'Kitchen', 'Faucet', 'Plumbing', 'needed', 'rough-in', '${NOW}', '${NOW}');
    INSERT INTO project_selection_choices (id, project_id, selection_id, title, lead_time_days, chosen, created_at, updated_at) VALUES
      ${choiceRow("zellige", "tile", 56)},
      ${choiceRow("subway", "tile", 14)},
      ${choiceRow("clawfoot", "tub", 90)},
      ${choiceRow("brass", "faucet", 10)};
    INSERT INTO schedule_tasks (id, project_id, title, start_date, workdays, end_date_calculated, phase, created_at, updated_at)
      VALUES ('t1', 'p1', 'Rough-in plumbing', '2027-01-29', 5, '2027-02-04', 'rough', '${NOW}', '${NOW}');
    INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at)
      VALUES ('org-1', 'selections', '{"rounds":[{"id":"rough-in","name":"Rough-in","scheduleItem":"rough-in","bufferDays":21}],"leadTimeDays":{},"leadTimeWarningDays":7,"ownerMarkupPercent":null,"changeOrderThresholdPercent":10}', '${NOW}');
  `)
})
afterEach(() => {
  sqlite.close()
})

function leadTimeTodos(): readonly { readonly title: string; readonly due_date: string | null; readonly assignee_name: string | null; readonly status: string }[] {
  return sqlite
    .prepare("SELECT title, due_date, assignee_name, status FROM project_operations WHERE json_extract(sage_payload_json, '$.selectionStep') = 'order_lead_time' ORDER BY created_at")
    .all()
    .map((row) => {
      if (typeof row !== "object" || row === null) throw new Error("bad row")
      return {
        title: String(Reflect.get(row, "title")),
        due_date: Reflect.get(row, "due_date") === null ? null : String(Reflect.get(row, "due_date")),
        assignee_name: Reflect.get(row, "assignee_name") === null ? null : String(Reflect.get(row, "assignee_name")),
        status: String(Reflect.get(row, "status")),
      }
    })
}

describe("selection lead times", () => {
  it("warns from the longest open lead time against the Selection Phase due date", async () => {
    const db = drizzleOverSqlite(sqlite)
    // Jan 8, 2027 − 56 days = Nov 13, 2026: four days from Nov 9.
    const context = await loadLeadTimeContext(db, { projectId: "p1", organizationId: "org-1", now: new Date(NOW) })
    expect(context).toMatchObject({ today: "2026-11-09", warnDays: 7 })
    const warnings = await loadSelectionLeadTimeWarnings(db, "p1", context)
    expect(warnings).toEqual([
      expect.objectContaining({ selectionId: "tile", choiceId: "zellige", orderByDate: "2026-11-13", neededByDate: "2027-01-08", level: "soon" }),
    ])
  })

  it("makes one to-do per selection and order-by date, even after it is finished", async () => {
    const db = drizzleOverSqlite(sqlite)
    expect(await createLeadTimeTodos(db, new Date(NOW))).toMatchObject({ created: 1 })
    expect(leadTimeTodos()).toEqual([
      { title: "Place long-lead order for Backsplash", due_date: "2026-11-13", assignee_name: "Pat PM", status: "open" },
    ])
    expect(await createLeadTimeTodos(db, new Date(NOW))).toMatchObject({ created: 0 })

    sqlite.exec("UPDATE project_operations SET status = 'completed' WHERE json_extract(sage_payload_json, '$.selectionStep') = 'order_lead_time'")
    expect(await createLeadTimeTodos(db, new Date(NOW))).toMatchObject({ created: 0 })

    // A longer lead time moves the order-by date: a fresh to-do.
    sqlite.exec("UPDATE project_selection_choices SET lead_time_days = 60 WHERE id = 'zellige'")
    expect(await createLeadTimeTodos(db, new Date(NOW))).toMatchObject({ created: 1 })
    expect(leadTimeTodos().map((todo) => todo.due_date)).toEqual(["2026-11-13", "2026-11-09"])
  })

  it("stops once the selection is ordered", async () => {
    const db = drizzleOverSqlite(sqlite)
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'tile'")
    expect(await createLeadTimeTodos(db, new Date(NOW))).toMatchObject({ created: 0 })
    expect(leadTimeTodos()).toEqual([])
  })
})
