-- Project Messages lists each imported conversation's "last message I sent".
-- Its lookup (channel_id = ? AND user_id = ?) used messages_user_id_idx, so for a
-- staff account that sent thousands of imported messages it walked every one
-- (2.9M rows, ~10 s per 50 conversations on 2026-11-07) and the page timed out.
-- Additive only: no table is rebuilt.
CREATE INDEX IF NOT EXISTS messages_channel_user_created_idx ON messages (channel_id, user_id, created_at);
