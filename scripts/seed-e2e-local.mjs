import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

const databasePath = resolve(process.env.LOCAL_DB_PATH || "local.db")
const now = new Date().toISOString()
const today = now.slice(0, 10)
const previousWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10)
const publishedScheduleSnapshot = JSON.stringify({
  version: 1,
  tasks: [
    {
      id: "e2e-schedule-001",
      projectId: "e2e-project-001",
      title: "Published schedule commitment",
      startDate: today,
      workdays: 3,
      endDateCalculated: today,
      phase: "Preconstruction",
      displayColor: "blue",
      status: "IN_PROGRESS",
      isCriticalPath: true,
      isMilestone: false,
      percentComplete: 25,
      assignedTo: "Demo User",
      assignedUserId: "demo-user-001",
      ownerVisible: true,
      subVendorVisible: true,
      confirmationRequired: true,
      confirmationStatus: "pending",
      confirmationRequestedAt: now,
      confirmationRespondedAt: null,
      reminderSentAt: null,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "e2e-published-owner-only",
      projectId: "e2e-project-001",
      title: "Owner-visible published milestone",
      startDate: today,
      workdays: 1,
      endDateCalculated: today,
      phase: "Closeout",
      displayColor: "green",
      status: "PENDING",
      isCriticalPath: false,
      isMilestone: true,
      percentComplete: 0,
      assignedTo: null,
      assignedUserId: null,
      ownerVisible: true,
      subVendorVisible: false,
      confirmationRequired: false,
      confirmationStatus: "not_requested",
      confirmationRequestedAt: null,
      confirmationRespondedAt: null,
      reminderSentAt: null,
      sortOrder: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "e2e-published-sub-only",
      projectId: "e2e-project-001",
      title: "Partner-visible published delivery",
      startDate: today,
      workdays: 1,
      endDateCalculated: today,
      phase: "Procurement",
      displayColor: "orange",
      status: "PENDING",
      isCriticalPath: false,
      isMilestone: true,
      percentComplete: 0,
      assignedTo: "Demo Trade Partner",
      assignedUserId: null,
      ownerVisible: false,
      subVendorVisible: true,
      confirmationRequired: false,
      confirmationStatus: "not_requested",
      confirmationRequestedAt: null,
      confirmationRespondedAt: null,
      reminderSentAt: null,
      sortOrder: 3,
      createdAt: now,
      updatedAt: now,
    },
  ],
  dependencies: [],
  exceptions: [],
})

mkdirSync(dirname(databasePath), { recursive: true })

const db = new Database(databasePath)

const upsert = db.transaction(() => {
  db.prepare(`
    INSERT INTO organizations (
      id, name, slug, type, is_active, created_at, updated_at
    ) VALUES (
      'demo-org-meridian', 'Meridian Group', 'meridian-demo', 'demo', 1, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `).run(now, now)

  db.prepare(`
    INSERT INTO users (
      id, email, first_name, last_name, display_name, role, is_active,
      created_at, updated_at
    ) VALUES (
      'demo-user-001', 'demo@compass.build', 'Demo', 'User', 'Demo User',
      'admin', 1, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      role = excluded.role,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `).run(now, now)

  db.prepare(`
    INSERT INTO organization_members (
      id, organization_id, user_id, role, joined_at
    ) VALUES (
      'e2e-membership-001', 'demo-org-meridian', 'demo-user-001', 'admin', ?
    )
    ON CONFLICT(id) DO UPDATE SET role = excluded.role
  `).run(now)

  db.prepare(`
    INSERT INTO projects (
      id, project_number, name, status, address, client_name, project_manager,
      organization_id, owner_updates_enabled, owner_update_channel,
      owner_update_cadence, created_at, updated_at
    ) VALUES (
      'e2e-project-001', 'H-E2E-001', 'Regression Test Project', 'OPEN',
      '100 Test Lane', 'Compass Demo Client', 'Demo User',
      'demo-org-meridian', 1, 'compass', 'weekly', ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      project_number = excluded.project_number,
      name = excluded.name,
      status = excluded.status,
      organization_id = excluded.organization_id,
      updated_at = excluded.updated_at
  `).run(now, now)

  db.prepare(`
    INSERT INTO project_job_statuses (
      id, organization_id, label, active, sort_order, created_at, updated_at
    ) VALUES (
      'current', 'demo-org-meridian', 'Current', 1, 1, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      organization_id = excluded.organization_id,
      label = excluded.label,
      active = excluded.active,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `).run(now, now)

  db.prepare(`
    INSERT INTO project_members (
      id, project_id, user_id, role, assigned_at
    ) VALUES (
      'e2e-project-member-001', 'e2e-project-001', 'demo-user-001',
      'project_manager', ?
    )
    ON CONFLICT(id) DO UPDATE SET role = excluded.role
  `).run(now)

  db.prepare(`
    DELETE FROM user_schedule_preferences
    WHERE user_id = 'demo-user-001'
  `).run()

  db.prepare(`
    INSERT INTO schedule_tasks (
      id, project_id, title, start_date, workdays, end_date_calculated, phase,
      display_color, status, is_critical_path, is_milestone, percent_complete,
      assigned_to, sort_order, created_at, updated_at
    ) VALUES (
      'e2e-schedule-001', 'e2e-project-001', 'Regression Schedule Item',
      ?, 3, ?, 'Preconstruction', 'blue', 'IN_PROGRESS', 1, 0, 25,
      'Demo User', 1, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      start_date = excluded.start_date,
      end_date_calculated = excluded.end_date_calculated,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(previousWeek, previousWeek, now, now)

  db.prepare(`
    INSERT INTO channels (
      id, name, type, description, organization_id, project_id, is_private,
      audience, created_by, sort_order, created_at, updated_at
    ) VALUES (
      'e2e-channel-001', 'regression-project-team', 'text',
      'Project conversation fixture for reply workflow checks.',
      'demo-org-meridian', 'e2e-project-001', 0, 'staff',
      'demo-user-001', 1, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      project_id = excluded.project_id,
      updated_at = excluded.updated_at
  `).run(now, now)

  db.prepare(`
    INSERT INTO channel_members (
      id, channel_id, user_id, role, notify_level, joined_at
    ) VALUES (
      'e2e-channel-member-001', 'e2e-channel-001', 'demo-user-001',
      'owner', 'all', ?
    )
    ON CONFLICT(id) DO UPDATE SET
      role = excluded.role,
      notify_level = excluded.notify_level
  `).run(now)

  db.prepare(`
    INSERT INTO messages (
      id, channel_id, user_id, content, is_pinned, reply_count, created_at
    ) VALUES (
      'e2e-message-001', 'e2e-channel-001', 'demo-user-001',
      'Regression conversation message', 0, 0, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content
  `).run(now)

  const overflowScheduleItems = [
    ["e2e-schedule-002", "Overflow schedule item two", 2],
    ["e2e-schedule-003", "Overflow schedule item three", 3],
    ["e2e-schedule-004", "Overflow schedule item four", 4],
    ...Array.from({ length: 15 }, (_, index) => [
      `e2e-schedule-${String(index + 5).padStart(3, "0")}`,
      `Gantt overflow schedule item ${index + 5}`,
      index + 5,
    ]),
  ]
  const upsertOverflowScheduleItem = db.prepare(`
    INSERT INTO schedule_tasks (
      id, project_id, title, start_date, workdays, end_date_calculated, phase,
      display_color, status, is_critical_path, is_milestone, percent_complete,
      assigned_to, sort_order, created_at, updated_at
    ) VALUES (
      ?, 'e2e-project-001', ?, ?, 1, ?, 'Preconstruction', 'blue',
      'PENDING', 0, 0, 0, 'Demo User', ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      start_date = excluded.start_date,
      end_date_calculated = excluded.end_date_calculated,
      status = excluded.status,
      updated_at = excluded.updated_at
  `)
  for (const [id, title, sortOrder] of overflowScheduleItems) {
    const date =
      sortOrder <= 4 || sortOrder === 19
        ? today
        : new Date(Date.now() - (21 - (sortOrder - 5)) * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10)
    upsertOverflowScheduleItem.run(
      id,
      title,
      date,
      date,
      sortOrder,
      now,
      now
    )
  }

  db.prepare(`
    INSERT INTO daily_logs (
      id, project_id, author_id, source_system, log_date, weather_source,
      work_completed, issues, is_client_visible, review_status, sync_status,
      created_at, updated_at
    ) VALUES (
      'e2e-daily-log-001', 'e2e-project-001', 'demo-user-001', 'compass',
      ?, 'manual', 'Verified the regression test workspace.', 'None', 0,
      'draft', 'synced', ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      log_date = excluded.log_date,
      work_completed = excluded.work_completed,
      updated_at = excluded.updated_at
  `).run(today, now, now)

  db.prepare(`
    INSERT INTO project_operations (
      id, project_id, source_system, source_record_type, source_record_id,
      source_record_number, title, description, status, priority,
      assignee_type, assignee_name, company_name, due_date,
      sage_write_status, sync_direction, sync_status, created_at, updated_at
    ) VALUES (
      'e2e-todo-001', 'e2e-project-001', 'compass', 'todo',
      'e2e-schedule-001', 'E2E-TODO-001', 'Regression follow-up',
      'Seeded task for read-only workflow checks.', 'open', 'normal', 'user',
      'Demo User', 'Compass Demo Client', ?, 'not_ready', 'read', 'synced', ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      source_record_id = excluded.source_record_id,
      title = excluded.title,
      status = excluded.status,
      due_date = excluded.due_date,
      updated_at = excluded.updated_at
  `).run(today, now, now)

  db.prepare(`
    INSERT INTO schedule_task_links (
      id, schedule_task_id, project_id, resource_type, resource_id, label,
      href, created_by, created_at
    ) VALUES (
      'e2e-schedule-link-001', 'e2e-schedule-001', 'e2e-project-001',
      'rfi', 'e2e-rfi-private', 'Internal regression RFI link',
      '/dashboard/projects/e2e-project-001/rfis?item=e2e-rfi-private',
      'demo-user-001', ?
    )
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      href = excluded.href
  `).run(now)

  db.prepare(`
    INSERT INTO schedule_publications (
      id, project_id, snapshot_data, change_reason, published_by, published_at
    ) VALUES (
      'e2e-schedule-publication-001', 'e2e-project-001', ?,
      'Deterministic published schedule regression fixture.',
      'demo-user-001', ?
    )
    ON CONFLICT(id) DO UPDATE SET
      snapshot_data = excluded.snapshot_data,
      change_reason = excluded.change_reason,
      published_by = excluded.published_by,
      published_at = excluded.published_at
  `).run(publishedScheduleSnapshot, now)
})

try {
  upsert()
  console.log(`Seeded deterministic E2E data in ${databasePath}`)
} finally {
  db.close()
}
