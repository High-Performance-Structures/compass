-- Everyone assigned to a schedule item (owner decision 2026-10-31: all
-- assignees are equal, no lead or helper roles). Additive only.
--
-- schedule_tasks.assigned_to keeps every name, joined with ", ", and
-- schedule_tasks.assigned_user_id keeps the first linked account, so every
-- existing reader keeps working. schedule_task_assignees is not reused: its
-- rows need a reviewed imported participant and carry per-assignee response
-- authority, while these rows are the plain list people pick in the form.
-- scripts/schedule-task-people-backfill.mjs copies today's single assignee.
CREATE TABLE IF NOT EXISTS schedule_task_people (
  id text PRIMARY KEY NOT NULL,
  schedule_task_id text NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  position integer NOT NULL,
  display_name text NOT NULL,
  assigned_user_id text REFERENCES users(id) ON DELETE SET NULL,
  project_contact_id text REFERENCES project_contacts(id) ON DELETE SET NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS schedule_task_people_task_name_unique ON schedule_task_people (schedule_task_id, display_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS schedule_task_people_assigned_user_idx ON schedule_task_people (assigned_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS schedule_task_people_project_contact_idx ON schedule_task_people (project_contact_id);
