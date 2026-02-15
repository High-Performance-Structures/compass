-- Compass Desktop SQLite Schema
-- Mirrors the Drizzle schema for local offline storage

-- Auth and user management tables
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'office',
    google_email TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    logo_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_members (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    joined_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL
);

-- Project management tables
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    address TEXT,
    client_name TEXT,
    project_manager TEXT,
    organization_id TEXT REFERENCES organizations(id),
    netsuite_job_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    assigned_at TEXT NOT NULL
);

-- Schedule tables
CREATE TABLE IF NOT EXISTS schedule_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_date TEXT NOT NULL,
    workdays INTEGER NOT NULL,
    end_date_calculated TEXT NOT NULL,
    phase TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    is_critical_path INTEGER NOT NULL DEFAULT 0,
    is_milestone INTEGER NOT NULL DEFAULT 0,
    percent_complete INTEGER NOT NULL DEFAULT 0,
    assigned_to TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_dependencies (
    id TEXT PRIMARY KEY,
    predecessor_id TEXT NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
    successor_id TEXT NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'FS',
    lag_days INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workday_exceptions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'non_working',
    category TEXT NOT NULL DEFAULT 'company_holiday',
    recurrence TEXT NOT NULL DEFAULT 'one_time',
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_baselines (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    snapshot_data TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Customer and vendor tables
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    company TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    notes TEXT,
    netsuite_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Subcontractor',
    email TEXT,
    phone TEXT,
    address TEXT,
    netsuite_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Agent memory tables
CREATE TABLE IF NOT EXISTS agent_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    last_message_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
);

-- Slab persistent memory
CREATE TABLE IF NOT EXISTS slab_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    memory_type TEXT NOT NULL,
    tags TEXT,
    importance REAL NOT NULL DEFAULT 0.7,
    pinned INTEGER NOT NULL DEFAULT 0,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    created_at TEXT NOT NULL
);

-- Feedback tables
CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    name TEXT,
    email TEXT,
    page_url TEXT,
    user_agent TEXT,
    viewport_width INTEGER,
    viewport_height INTEGER,
    ip_hash TEXT,
    github_issue_url TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback_interviews (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    responses TEXT NOT NULL,
    summary TEXT NOT NULL,
    pain_points TEXT,
    feature_requests TEXT,
    overall_sentiment TEXT NOT NULL,
    github_issue_url TEXT,
    conversation_id TEXT,
    created_at TEXT NOT NULL
);

-- Push notification tokens
CREATE TABLE IF NOT EXISTS push_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Sync metadata for offline-first support
CREATE TABLE IF NOT EXISTS sync_metadata (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL UNIQUE,
    last_sync_at TEXT,
    sync_version INTEGER NOT NULL DEFAULT 0,
    pending_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation TEXT NOT NULL, -- 'create', 'update', 'delete'
    data TEXT, -- JSON payload for create/update
    created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    error TEXT
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_project ON schedule_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_predecessor ON task_dependencies(predecessor_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_successor ON task_dependencies(successor_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_conversation ON agent_memories(conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_user ON agent_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON sync_queue(table_name);
CREATE INDEX IF NOT EXISTS idx_sync_queue_record ON sync_queue(record_id);
