CREATE TABLE project_selection_decisions (
 selection_id TEXT PRIMARY KEY NOT NULL REFERENCES project_finish_selections(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0,
 specification_json TEXT NOT NULL, decision_due_date TEXT,
 allowance_cents INTEGER, quoted_cents INTEGER, schedule_impact TEXT, owner_note TEXT,
 change_order_id TEXT, requires_change_order INTEGER NOT NULL DEFAULT 0,
 approved_by TEXT, approved_by_name TEXT, approved_at TEXT,
 last_mutation_id TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE project_selection_requests (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 selection_id TEXT NOT NULL REFERENCES project_finish_selections(id) ON DELETE CASCADE,
 requester_id TEXT NOT NULL, requester_name TEXT NOT NULL, kind TEXT NOT NULL,
 note TEXT NOT NULL, product_url TEXT, status TEXT NOT NULL DEFAULT 'open', response TEXT,
 last_mutation_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE project_selection_decision_events (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 selection_id TEXT NOT NULL, revision INTEGER NOT NULL, actor_id TEXT NOT NULL,
 actor_name TEXT NOT NULL, kind TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE project_selection_procurement_links (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 selection_id TEXT NOT NULL REFERENCES project_finish_selections(id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL REFERENCES project_operations(id) ON DELETE CASCADE,
 specification_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX selection_procurement_pair ON project_selection_procurement_links(selection_id, operation_id);
CREATE INDEX selection_decisions_project ON project_selection_decisions(project_id);
CREATE INDEX selection_requests_project ON project_selection_requests(project_id, status);
CREATE INDEX selection_events_history ON project_selection_decision_events(project_id, selection_id, created_at);
