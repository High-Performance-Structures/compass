import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"

import {
  linkedScheduleTaskId,
  linkedTodoSourceLabel,
} from "@/lib/schedule/linked-todos"
import { LINKED_TODO_DATE_UPDATE_SQL } from "@/lib/schedule/linked-todo-sync"

describe("linked schedule to-dos", () => {
  it("only treats a to-do source ID as a schedule link when the item exists", () => {
    const scheduleTaskIds = new Set(["schedule-1"])

    expect(
      linkedScheduleTaskId(
        {
          sourceRecordType: "schedule_task",
          sourceRecordId: "schedule-1",
        },
        scheduleTaskIds
      )
    ).toBe("schedule-1")
    expect(
      linkedScheduleTaskId(
        {
          sourceRecordType: "staff_task",
          sourceRecordId: "selection-1",
        },
        scheduleTaskIds
      )
    ).toBeNull()
    expect(
      linkedScheduleTaskId(
        {
          sourceRecordType: "purchase_order",
          sourceRecordId: "schedule-1",
        },
        scheduleTaskIds
      )
    ).toBeNull()
  })

  it("labels linked work-queue entries with the schedule item and to-do number", () => {
    expect(linkedTodoSourceLabel("Footer Pour", "TASK-014")).toBe(
      "Schedule: Footer Pour · TASK-014"
    )
    expect(linkedTodoSourceLabel("Footer Pour", null)).toBe(
      "Schedule: Footer Pour"
    )
  })
})

describe("linked to-do date synchronization", () => {
  const databases: ReturnType<typeof Database>[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  it("preserves schedule-relative offsets without touching unrelated rows", () => {
    const database = new Database(":memory:")
    databases.push(database)
    database.exec(`
      CREATE TABLE schedule_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date_calculated TEXT NOT NULL
      );
      CREATE TABLE project_operations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_record_type TEXT NOT NULL,
        source_record_id TEXT,
        start_date TEXT,
        due_date TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO schedule_tasks VALUES
        ('schedule-1', 'project-1', '2026-08-10', '2026-08-14'),
        ('schedule-2', 'project-1', '2026-08-10', '2026-08-14');
      INSERT INTO project_operations VALUES
        ('same-offset', 'project-1', 'schedule_task', 'schedule-1', '2026-08-10', '2026-08-14', 'old'),
        ('offset-two', 'project-1', 'staff_task', 'schedule-1', '2026-08-12', '2026-08-16', 'old'),
        ('null-dates', 'project-1', 'task', 'schedule-1', NULL, NULL, 'old'),
        ('invalid-dates', 'project-1', 'todo', 'schedule-1', 'unknown', 'unknown', 'old'),
        ('other-project', 'project-2', 'schedule_task', 'schedule-1', '2026-08-10', '2026-08-14', 'old'),
        ('other-schedule', 'project-1', 'schedule_task', 'schedule-2', '2026-08-10', '2026-08-14', 'old'),
        ('non-task', 'project-1', 'purchase_order', 'schedule-1', '2026-08-10', '2026-08-14', 'old');
    `)

    database.prepare(LINKED_TODO_DATE_UPDATE_SQL).run(
      "2026-08-20",
      "schedule-1",
      "2026-08-24",
      "schedule-1",
      "new",
      "schedule-1",
      "schedule-1"
    )

    const rows = database
      .prepare(
        "SELECT id, start_date, due_date, updated_at FROM project_operations ORDER BY id"
      )
      .all()

    expect(rows).toEqual([
      {
        id: "invalid-dates",
        start_date: "unknown",
        due_date: "unknown",
        updated_at: "new",
      },
      {
        id: "non-task",
        start_date: "2026-08-10",
        due_date: "2026-08-14",
        updated_at: "old",
      },
      {
        id: "null-dates",
        start_date: null,
        due_date: null,
        updated_at: "new",
      },
      {
        id: "offset-two",
        start_date: "2026-08-22",
        due_date: "2026-08-26",
        updated_at: "new",
      },
      {
        id: "other-project",
        start_date: "2026-08-10",
        due_date: "2026-08-14",
        updated_at: "old",
      },
      {
        id: "other-schedule",
        start_date: "2026-08-10",
        due_date: "2026-08-14",
        updated_at: "old",
      },
      {
        id: "same-offset",
        start_date: "2026-08-20",
        due_date: "2026-08-24",
        updated_at: "new",
      },
    ])
  })
})
