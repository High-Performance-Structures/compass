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
    INSERT INTO users (
      id, email, first_name, last_name, display_name, role, is_active,
      created_at, updated_at
    ) VALUES (
      'e2e-user-002', 'field@compass.build', 'Field', 'Tester', 'Field Tester',
      'field', 1, ?, ?
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
    INSERT INTO organization_members (
      id, organization_id, user_id, role, joined_at
    ) VALUES (
      'e2e-membership-002', 'demo-org-meridian', 'e2e-user-002', 'member', ?
    )
    ON CONFLICT(id) DO UPDATE SET role = excluded.role
  `).run(now)

  db.prepare(`
    INSERT INTO projects (
      id, project_number, name, status, address, client_name, project_manager,
      organization_id, owner_updates_enabled, owner_update_channel,
      owner_update_cadence, schedule_published, created_at, updated_at
    ) VALUES (
      'e2e-project-001', 'H-E2E-001', 'Regression Test Project', 'OPEN',
      '100 Test Lane', 'Compass Demo Client', 'Demo User',
      'demo-org-meridian', 1, 'compass', 'weekly', 1, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      project_number = excluded.project_number,
      name = excluded.name,
      status = excluded.status,
      organization_id = excluded.organization_id,
      schedule_published = excluded.schedule_published,
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
    INSERT INTO channel_members (
      id, channel_id, user_id, role, notify_level, joined_at
    ) VALUES (
      'e2e-channel-member-002', 'e2e-channel-001', 'e2e-user-002',
      'member', 'all', ?
    )
    ON CONFLICT(id) DO UPDATE SET
      role = excluded.role,
      notify_level = excluded.notify_level
  `).run(now)

  db.prepare(`
    DELETE FROM messages
    WHERE channel_id = 'e2e-channel-001'
      AND id LIKE 'e2e-message-%'
  `).run()

  const insertConversationMessage = db.prepare(`
    INSERT INTO messages (
      id, channel_id, user_id, content, is_pinned, reply_count, created_at
    ) VALUES (?, 'e2e-channel-001', ?, ?, 0, 0, ?)
  `)
  for (let index = 1; index <= 64; index += 1) {
    const createdAt = new Date(Date.now() - (65 - index) * 60 * 1000).toISOString()
    const userId = index % 2 === 0 ? 'e2e-user-002' : 'demo-user-001'
    insertConversationMessage.run(
      `e2e-message-history-${String(index).padStart(3, "0")}`,
      userId,
      `History message ${String(index).padStart(3, "0")}`,
      createdAt,
    )
  }
  insertConversationMessage.run(
    'e2e-message-001',
    'demo-user-001',
    'Regression conversation message',
    now,
  )

  // Correspondence deliberately rejects demo users; use the existing local dev identity.
  db.prepare(`INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at)
    VALUES ('hps-org-001', 'HPS test organization', 'e2e-hps', 'internal', 1, ?, ?) ON CONFLICT(id) DO NOTHING`).run(now, now)
  db.prepare(`INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at)
    VALUES ('dev-user-1', 'dev@compass.io', 'Dev User', 'admin', 1, ?, ?) ON CONFLICT(id) DO NOTHING`).run(now, now)
  db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, role, joined_at)
    VALUES ('e2e-hps-membership', 'hps-org-001', 'dev-user-1', 'admin', ?) ON CONFLICT(id) DO NOTHING`).run(now)
  db.prepare(`INSERT INTO projects (id, project_number, name, status, organization_id, created_at, updated_at)
    VALUES ('e2e-correspondence-project-001', 'H-E2E-002', 'Correspondence Regression Project', 'OPEN', 'hps-org-001', ?, ?) ON CONFLICT(id) DO NOTHING`).run(now, now)
  db.prepare(`INSERT INTO project_correspondence (id, organization_id, project_id, subject, created_at)
    VALUES ('e2e-quiet-correspondence-001', 'hps-org-001', 'e2e-correspondence-project-001', 'Quiet rows regression conversation', ?)
    ON CONFLICT(id) DO NOTHING`).run(now)
  const insertParticipant = db.prepare(`INSERT INTO correspondence_participants (id, conversation_id, user_id, name, email, role)
    VALUES (?, 'e2e-quiet-correspondence-001', ?, ?, ?, 'staff') ON CONFLICT(id) DO NOTHING`)
  insertParticipant.run('e2e-quiet-correspondence-person-001', 'dev-user-1', 'Dev User', 'dev@compass.io')
  insertParticipant.run('e2e-quiet-correspondence-person-002', 'e2e-user-002', 'Field Tester', 'field@compass.build')
  const insertCorrespondence = db.prepare(`INSERT INTO correspondence_messages
    (id, conversation_id, author_user_id, author_name, source, body, sent_at, request_hash)
    VALUES (?, 'e2e-quiet-correspondence-001', ?, ?, 'compass', ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
  const insertRecipient = db.prepare(`INSERT INTO correspondence_recipients (id, message_id, user_id, name, kind, baseline)
    VALUES (?, ?, 'dev-user-1', 'Dev User', ?, 1) ON CONFLICT(id) DO NOTHING`)
  for (let index = 1; index <= 65; index += 1) {
    const id = `e2e-quiet-correspondence-message-${String(index).padStart(3, '0')}`
    const own = index % 2 === 1
    insertCorrespondence.run(id, own ? 'dev-user-1' : 'e2e-user-002', own ? 'Dev User' : 'Field Tester',
      `Correspondence history ${String(index).padStart(3, '0')}`, new Date(Date.now() - (66 - index) * 60_000).toISOString(), id)
    insertRecipient.run(`${id}-recipient`, id, own ? 'author' : 'to')
  }

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
