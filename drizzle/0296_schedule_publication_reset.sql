-- Staff can treat a draft schedule as never published: publications made
-- before this time stop counting, so edits need no shift reasons and the next
-- publish is a first publication. Earlier publications stay in history.
ALTER TABLE projects ADD COLUMN schedule_publication_reset_at text;
