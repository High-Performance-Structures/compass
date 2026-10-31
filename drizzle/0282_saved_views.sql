-- Saved views consolidation (docs/development/data-model-consolidation.md, section 3).
-- Additive only: project_saved_views, schedule_saved_views and user_view_preferences
-- keep their rows. scripts/saved-views-backfill.mjs copies them here, keeping ids.
CREATE TABLE IF NOT EXISTS saved_views (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('projects', 'schedule')),
  name text NOT NULL,
  visibility text NOT NULL DEFAULT 'personal' CHECK (visibility IN ('personal', 'shared')),
  definition text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_org_owner_scope_name_unique ON saved_views (organization_id, owner_user_id, scope, name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS saved_views_org_scope_visibility_idx ON saved_views (organization_id, scope, visibility);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS saved_views_owner_idx ON saved_views (owner_user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS saved_view_defaults (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('projects', 'schedule')),
  view_id text REFERENCES saved_views(id) ON DELETE SET NULL,
  inline_definition text,
  updated_at text NOT NULL,
  PRIMARY KEY (user_id, organization_id, scope)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS saved_view_defaults_org_idx ON saved_view_defaults (organization_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS saved_view_defaults_view_idx ON saved_view_defaults (view_id);
