CREATE TABLE project_field_cost_codes (
  project_id text PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  codes_json text NOT NULL CHECK (json_valid(codes_json) AND json_type(codes_json) = 'array'),
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX project_field_cost_codes_org_idx ON project_field_cost_codes (organization_id);
