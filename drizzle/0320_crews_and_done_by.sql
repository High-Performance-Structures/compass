-- Crews and "Done by" (2026-11-12). Additive only.
-- A crew is a team of the company's own staff (teams / team_members) with
-- the department whose work it does and an optional lead. Schedule items can
-- be assigned to a crew (schedule_task_people.team_id), and record which
-- department performs the work (schedule_tasks.performing_department: a code or
-- 'outside'; NULL = not set).
ALTER TABLE teams ADD COLUMN department text;
ALTER TABLE teams ADD COLUMN lead_user_id text REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX teams_lead_user_id_idx ON teams (lead_user_id);
CREATE UNIQUE INDEX teams_organization_name_unique ON teams (organization_id, name);

ALTER TABLE schedule_task_people ADD COLUMN team_id text REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX schedule_task_people_team_idx ON schedule_task_people (team_id);

ALTER TABLE schedule_tasks ADD COLUMN performing_department text;
