// Pure planning for scripts/schedule-task-people-backfill.mjs (migration 0284).

/** A SQL string literal (or NULL / a finite number). */
export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

/**
 * One people row per schedule item that has a single assigned_to and no
 * people yet. The whole stored name becomes the row, so the joined people
 * list equals assigned_to exactly (a stored "Smith, John" stays one person),
 * and assigned_user_id carries over. Blank names are skipped.
 */
export function planScheduleTaskPeopleBackfill(tasks, { now, newId }) {
  const rows = []
  const skipped = []
  for (const task of tasks) {
    const name = typeof task.assigned_to === "string" ? task.assigned_to : ""
    if (!name.trim()) {
      skipped.push({ id: task.id, reason: "blank assigned_to" })
      continue
    }
    rows.push({
      id: newId(),
      schedule_task_id: task.id,
      position: 0,
      display_name: name,
      assigned_user_id: task.assigned_user_id ?? null,
      project_contact_id: null,
      created_at: now,
    })
  }
  return { rows, skipped }
}

const COLUMNS = ["id", "schedule_task_id", "position", "display_name", "assigned_user_id", "project_contact_id", "created_at"]

/**
 * One guarded INSERT per row: it writes only while the item still has no
 * people and still has the same assigned_to, so a re-run, or an item edited
 * since the read, is left alone.
 */
export function insertStatements(rows) {
  return rows.map(
    (row) =>
      `INSERT INTO schedule_task_people (${COLUMNS.join(", ")}) SELECT ${COLUMNS.map((column) => sqlLiteral(row[column])).join(", ")} ` +
      `WHERE NOT EXISTS (SELECT 1 FROM schedule_task_people WHERE schedule_task_id = ${sqlLiteral(row.schedule_task_id)}) ` +
      `AND EXISTS (SELECT 1 FROM schedule_tasks WHERE id = ${sqlLiteral(row.schedule_task_id)} AND assigned_to = ${sqlLiteral(row.display_name)});`,
  )
}
