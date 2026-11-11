-- Schedule: what subs and suppliers see of a job's published schedule.
-- 'assigned' (the default): items marked "Subs can view" plus every item they
-- are responsible for. 'full': every published item. Additive only; every
-- existing job starts on 'assigned'.
ALTER TABLE projects ADD COLUMN sub_schedule_view text NOT NULL DEFAULT 'assigned';
