-- LOCAL D1 ONLY. Seeds off-list values for scripts/status-values-report.mjs:
--   bunx wrangler d1 execute compass-db --local --file scripts/fixtures/status-values-local.sql
--   bun scripts/status-values-report.mjs --local
-- Expected: feedback.type "Bug" and " feature " and users.role "Project Manager"
-- get UPDATEs (case/spacing), trade_letters-style spellings are covered by
-- unit tests, and feedback.type "complaint" and projects.client_status
-- "prospect" go to review.
INSERT OR REPLACE INTO feedback (id, type, message, created_at) VALUES
  ('status-fixture-1', 'bug', 'listed value', '2026-10-31T00:00:00.000Z'),
  ('status-fixture-2', 'Bug', 'case variant', '2026-10-31T00:00:00.000Z'),
  ('status-fixture-3', ' feature ', 'whitespace variant', '2026-10-31T00:00:00.000Z'),
  ('status-fixture-4', 'complaint', 'unknown value', '2026-10-31T00:00:00.000Z');

INSERT OR REPLACE INTO users (id, email, role, created_at, updated_at) VALUES
  ('status-fixture-user', 'status-fixture@example.com', 'Project Manager', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');

INSERT OR REPLACE INTO projects (id, name, status, client_status, created_at) VALUES
  ('status-fixture-project', 'Status fixture', 'OPEN', 'prospect', '2026-10-31T00:00:00.000Z');
