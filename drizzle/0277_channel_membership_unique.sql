-- One channel membership and one read state per person per channel. A
-- 2026-07-01 double-insert (28 ms apart) left one duplicate pair in each table;
-- the later copy of each is removed (owner-approved 2026-10-30, rows backed up)
-- before the unique indexes are added. Keeps the earliest row of any pair.
DELETE FROM channel_members WHERE EXISTS (
  SELECT 1 FROM channel_members earlier
  WHERE earlier.channel_id = channel_members.channel_id
    AND earlier.user_id = channel_members.user_id
    AND (earlier.joined_at < channel_members.joined_at
      OR (earlier.joined_at = channel_members.joined_at AND earlier.id < channel_members.id))
);
--> statement-breakpoint
DELETE FROM channel_read_state WHERE EXISTS (
  SELECT 1 FROM channel_read_state earlier
  WHERE earlier.channel_id = channel_read_state.channel_id
    AND earlier.user_id = channel_read_state.user_id
    AND (earlier.last_read_at < channel_read_state.last_read_at
      OR (earlier.last_read_at = channel_read_state.last_read_at AND earlier.id < channel_read_state.id))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS channel_members_channel_user_unique ON channel_members (channel_id, user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS channel_read_state_channel_user_unique ON channel_read_state (channel_id, user_id);
