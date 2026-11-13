import { describe, expect, it } from "vitest"

import { migratedSqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"
import { insertRow } from "@/test/migrated-database"

import {
  linkedScheduleTaskId,
  linkedTodoSourceLabel,
} from "@/lib/schedule/linked-todos"
import { LINKED_TODO_DATE_UPDATE_SQL } from "@/lib/domain/operations/store"

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
  it("preserves schedule-relative offsets without touching unrelated rows", () => {
    // node:sqlite, which binds D1-style numbered parameters (?1) positionally,
    // over production's schema (every migration) with the parents its keys need.
    const database = migratedSqlite()
    insertRow(database, "organizations", { id: "org", type: "internal" })
    for (const id of ["project-1", "project-2"]) insertRow(database, "projects", { id, organization_id: "org" })
    for (const id of ["schedule-1", "schedule-2"]) {
      insertRow(database, "schedule_tasks", {
        id, project_id: "project-1", start_date: "2026-08-10", end_date_calculated: "2026-08-14",
      })
    }
    const operations: readonly (readonly [string, string, string, string, string | null, string | null])[] = [
      ["same-offset", "project-1", "schedule_task", "schedule-1", "2026-08-10", "2026-08-14"],
      ["offset-two", "project-1", "staff_task", "schedule-1", "2026-08-12", "2026-08-16"],
      ["null-dates", "project-1", "task", "schedule-1", null, null],
      ["invalid-dates", "project-1", "todo", "schedule-1", "unknown", "unknown"],
      ["other-project", "project-2", "schedule_task", "schedule-1", "2026-08-10", "2026-08-14"],
      ["other-schedule", "project-1", "schedule_task", "schedule-2", "2026-08-10", "2026-08-14"],
      ["non-task", "project-1", "purchase_order", "schedule-1", "2026-08-10", "2026-08-14"],
    ]
    for (const [id, projectId, sourceRecordType, sourceRecordId, startDate, dueDate] of operations) {
      insertRow(database, "project_operations", {
        id, project_id: projectId, source_record_type: sourceRecordType, source_record_id: sourceRecordId,
        start_date: startDate, due_date: dueDate, status: "open", updated_at: "old",
      })
    }

    database.prepare(LINKED_TODO_DATE_UPDATE_SQL).run(
      JSON.stringify({ "schedule-1": ["2026-08-20", "2026-08-24"] }),
      "new",
      "project-1"
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
