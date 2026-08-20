export const LINKED_TODO_DATE_UPDATE_SQL = `UPDATE project_operations
SET start_date = CASE
  WHEN start_date IS NULL OR julianday(start_date) IS NULL THEN start_date
  ELSE date(
    ?,
    printf(
      '%+d days',
      CAST(
        julianday(start_date) - julianday((
          SELECT start_date
          FROM schedule_tasks
          WHERE id = ?
        )) AS INTEGER
      )
    )
  )
END,
due_date = CASE
  WHEN due_date IS NULL OR julianday(due_date) IS NULL THEN due_date
  ELSE date(
    ?,
    printf(
      '%+d days',
      CAST(
        julianday(due_date) - julianday((
          SELECT end_date_calculated
          FROM schedule_tasks
          WHERE id = ?
        )) AS INTEGER
      )
    )
  )
END,
updated_at = ?
WHERE source_record_id = ?
  AND project_id = (
    SELECT project_id FROM schedule_tasks WHERE id = ?
  )
  AND source_record_type IN (
    'staff_task',
    'subcontractor_task',
    'supplier_task',
    'schedule_task',
    'todo',
    'task'
  )`

export function linkedTodoDateUpdateStatement(
  database: D1Database,
  input: {
    readonly scheduleTaskId: string
    readonly nextStartDate: string
    readonly nextEndDate: string
    readonly updatedAt: string
  }
): D1PreparedStatement {
  // Run this before updating schedule_tasks so offsets are calculated from the
  // schedule item's previous dates.
  return database
    .prepare(LINKED_TODO_DATE_UPDATE_SQL)
    .bind(
      input.nextStartDate,
      input.scheduleTaskId,
      input.nextEndDate,
      input.scheduleTaskId,
      input.updatedAt,
      input.scheduleTaskId,
      input.scheduleTaskId
    )
}
