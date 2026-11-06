-- Settings > Lists: each company's layout for a list sheet (columns shown,
-- their order, the default sort and the status filter it opens on), plus each
-- person's own hidden or shown columns from the sheet's Columns button.
-- Sheet keys and column ids are code constants from the list sheet registry;
-- unknown ones are ignored on read. Additive only: two new tables.
CREATE TABLE IF NOT EXISTS organization_list_sheet_settings (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sheet_key text NOT NULL,
  columns text NOT NULL,
  sort_column text,
  sort_direction text CHECK (sort_direction IN ('asc', 'desc')),
  start_filter text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS organization_list_sheet_settings_org_sheet_unique ON organization_list_sheet_settings (organization_id, sheet_key);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS user_list_sheet_column_preferences (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sheet_key text NOT NULL,
  hidden_column_ids text DEFAULT '[]' NOT NULL,
  shown_column_ids text DEFAULT '[]' NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS user_list_sheet_column_preferences_user_org_sheet_unique ON user_list_sheet_column_preferences (user_id, organization_id, sheet_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_list_sheet_column_preferences_org_sheet_idx ON user_list_sheet_column_preferences (organization_id, sheet_key);
