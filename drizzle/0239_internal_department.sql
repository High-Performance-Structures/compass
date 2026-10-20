-- Internal workspaces (office duty logs, the owner's office, yards) listed
-- under the company's Internal department instead of their own department.
-- Additive only: the department letter, workspace kind and Sage job stay.
ALTER TABLE `projects` ADD `internal_department` integer DEFAULT false NOT NULL;
