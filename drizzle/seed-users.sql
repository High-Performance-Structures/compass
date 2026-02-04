-- seed users for development
INSERT INTO users (id, email, first_name, last_name, display_name, avatar_url, role, is_active, last_login_at, created_at, updated_at)
VALUES
  ('user-1', 'admin@compass.io', 'Admin', 'User', 'Admin User', NULL, 'admin', 1, '2026-02-04T12:00:00Z', '2026-01-01T00:00:00Z', '2026-02-04T12:00:00Z'),
  ('user-2', 'john@compass.io', 'John', 'Smith', 'John Smith', NULL, 'office', 1, '2026-02-03T10:30:00Z', '2026-01-15T00:00:00Z', '2026-02-03T10:30:00Z'),
  ('user-3', 'sarah@compass.io', 'Sarah', 'Johnson', 'Sarah Johnson', NULL, 'office', 1, '2026-02-04T08:15:00Z', '2026-01-20T00:00:00Z', '2026-02-04T08:15:00Z'),
  ('user-4', 'mike@compass.io', 'Mike', 'Wilson', 'Mike Wilson', NULL, 'field', 1, '2026-02-02T14:20:00Z', '2026-01-25T00:00:00Z', '2026-02-02T14:20:00Z'),
  ('user-5', 'client@example.com', 'Jane', 'Client', 'Jane Client', NULL, 'client', 1, '2026-02-01T09:00:00Z', '2026-02-01T00:00:00Z', '2026-02-01T09:00:00Z');

-- seed organizations
INSERT INTO organizations (id, name, slug, type, logo_url, is_active, created_at, updated_at)
VALUES
  ('org-1', 'Open Range Construction', 'open-range', 'internal', NULL, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('org-2', 'Example Corp', 'example-corp', 'client', NULL, 1, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');

-- seed organization members
INSERT INTO organization_members (id, organization_id, user_id, role, joined_at)
VALUES
  ('om-1', 'org-1', 'user-1', 'admin', '2026-01-01T00:00:00Z'),
  ('om-2', 'org-1', 'user-2', 'office', '2026-01-15T00:00:00Z'),
  ('om-3', 'org-1', 'user-3', 'office', '2026-01-20T00:00:00Z'),
  ('om-4', 'org-1', 'user-4', 'field', '2026-01-25T00:00:00Z'),
  ('om-5', 'org-2', 'user-5', 'client', '2026-02-01T00:00:00Z');

-- seed teams
INSERT INTO teams (id, organization_id, name, description, created_at)
VALUES
  ('team-1', 'org-1', 'Engineering Team', 'Main engineering team', '2026-01-01T00:00:00Z'),
  ('team-2', 'org-1', 'Field Crew Alpha', 'Field crew for site work', '2026-01-01T00:00:00Z');

-- seed team members
INSERT INTO team_members (id, team_id, user_id, joined_at)
VALUES
  ('tm-1', 'team-1', 'user-2', '2026-01-15T00:00:00Z'),
  ('tm-2', 'team-1', 'user-3', '2026-01-20T00:00:00Z'),
  ('tm-3', 'team-2', 'user-4', '2026-01-25T00:00:00Z');

-- seed groups
INSERT INTO groups (id, organization_id, name, description, color, created_at)
VALUES
  ('group-1', 'org-1', 'Project Managers', 'Project management group', '#3b82f6', '2026-01-01T00:00:00Z'),
  ('group-2', 'org-1', 'Field Supervisors', 'Field supervision group', '#10b981', '2026-01-01T00:00:00Z');

-- seed group members
INSERT INTO group_members (id, group_id, user_id, joined_at)
VALUES
  ('gm-1', 'group-1', 'user-2', '2026-01-15T00:00:00Z'),
  ('gm-2', 'group-2', 'user-4', '2026-01-25T00:00:00Z');

-- seed project members (using existing project)
INSERT INTO project_members (id, project_id, user_id, role, assigned_at)
VALUES
  ('pm-1', 'proj-o-001', 'user-1', 'admin', '2026-01-01T00:00:00Z'),
  ('pm-2', 'proj-o-001', 'user-2', 'manager', '2026-01-15T00:00:00Z'),
  ('pm-3', 'proj-o-001', 'user-4', 'crew', '2026-01-25T00:00:00Z'),
  ('pm-4', 'proj-o-002', 'user-2', 'manager', '2026-01-16T00:00:00Z'),
  ('pm-5', 'proj-o-003', 'user-3', 'manager', '2026-01-21T00:00:00Z');
