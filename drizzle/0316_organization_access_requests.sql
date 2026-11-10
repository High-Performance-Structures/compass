-- Request access: a signed-in person asks to join a company that allows
-- requests. Staff link the request to a directory record and approve or
-- decline it; nothing is granted automatically. Additive only. The per-company
-- "Allow access requests" switch is a feature setting (off by default), so no
-- company is opened by this migration.
CREATE TABLE IF NOT EXISTS organization_access_requests (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  kind text NOT NULL,
  company_name text,
  phone text,
  job_reference text,
  note text,
  status text DEFAULT 'pending' NOT NULL,
  customer_contact_id text REFERENCES customer_contacts(id) ON DELETE set null,
  vendor_contact_id text REFERENCES vendor_contacts(id) ON DELETE set null,
  granted_role text,
  granted_project_count integer,
  decided_by text REFERENCES users(id) ON DELETE set null,
  decided_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_access_requests_one_pending
  ON organization_access_requests (organization_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS organization_access_requests_org_status_idx
  ON organization_access_requests (organization_id, status, created_at);
CREATE INDEX IF NOT EXISTS organization_access_requests_user_idx
  ON organization_access_requests (user_id, status);
CREATE INDEX IF NOT EXISTS organization_access_requests_customer_contact_idx
  ON organization_access_requests (customer_contact_id);
CREATE INDEX IF NOT EXISTS organization_access_requests_vendor_contact_idx
  ON organization_access_requests (vendor_contact_id);
CREATE INDEX IF NOT EXISTS organization_access_requests_decided_by_idx
  ON organization_access_requests (decided_by);
