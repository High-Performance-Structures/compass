CREATE TABLE project_saved_views (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  visibility text NOT NULL DEFAULT 'personal' CHECK (visibility IN ('personal', 'shared')),
  definition text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX project_saved_views_org_idx ON project_saved_views (organization_id);
--> statement-breakpoint
CREATE UNIQUE INDEX project_saved_views_owner_org_name_unique ON project_saved_views (owner_user_id, organization_id, name);
