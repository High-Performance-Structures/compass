-- One row per membership, reaction, push token, and imported RFI
-- (architecture standard, section 3: link tables are unique on their pair,
-- imported rows on their source id). Production had no duplicates in any of
-- these on 2026-10-30, so no data changes. Additive only.
CREATE UNIQUE INDEX IF NOT EXISTS organization_members_org_user_unique ON organization_members (organization_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_user_unique ON project_members (project_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_team_user_unique ON team_members (team_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS group_members_group_user_unique ON group_members (group_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS message_reactions_message_user_emoji_unique ON message_reactions (message_id, user_id, emoji);
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_unique ON push_tokens (token);
CREATE UNIQUE INDEX IF NOT EXISTS project_rfis_source_record_unique ON project_rfis (source_system, source_record_id) WHERE source_record_id IS NOT NULL;
