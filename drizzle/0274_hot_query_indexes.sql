-- Production D1 query insights (7 days to 2026-10-30) showed the busiest
-- reads scanning whole tables because their lookup columns had no index:
-- the project registry's "not removed / not a duplicate" checks rescanned
-- project_duplicate_decisions once per project (~47k rows per list), and
-- schedule, chat and notification views scanned every row on each load.
-- Additive only: no table is rebuilt.
CREATE INDEX IF NOT EXISTS project_duplicate_decisions_removed_idx ON project_duplicate_decisions (removed_project_id, status);
CREATE INDEX IF NOT EXISTS project_registry_removals_project_idx ON project_registry_removals (project_id);
CREATE INDEX IF NOT EXISTS schedule_tasks_project_start_idx ON schedule_tasks (project_id, start_date);
CREATE INDEX IF NOT EXISTS schedule_tasks_assigned_user_idx ON schedule_tasks (assigned_user_id);
CREATE INDEX IF NOT EXISTS messages_channel_thread_created_idx ON messages (channel_id, thread_id, created_at);
CREATE INDEX IF NOT EXISTS messages_thread_created_idx ON messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS channel_members_channel_user_idx ON channel_members (channel_id, user_id);
CREATE INDEX IF NOT EXISTS channel_members_user_idx ON channel_members (user_id);
CREATE INDEX IF NOT EXISTS notification_recipients_event_idx ON notification_recipients (event_id);
CREATE INDEX IF NOT EXISTS notification_events_org_source_idx ON notification_events (organization_id, source_type, event_type, created_at);
