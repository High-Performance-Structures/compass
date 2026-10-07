-- Membership lookups run on every authenticated request (current user's
-- organizations and projects) and in project access checks. Neither table
-- had an index beyond its primary key.
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON organization_members (user_id);
CREATE INDEX IF NOT EXISTS organization_members_org_user_idx ON organization_members (organization_id, user_id);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members (user_id);
CREATE INDEX IF NOT EXISTS project_members_project_user_idx ON project_members (project_id, user_id);
