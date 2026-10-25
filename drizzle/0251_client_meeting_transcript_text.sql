-- The transcript's own text, so Compass can show and print it in its standard
-- document preview. The draft daily log made from it can be edited; this can't.
ALTER TABLE `project_client_meetings` ADD `transcript_text` text;
