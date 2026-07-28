ALTER TABLE `feedback_desk_items`
  ADD COLUMN `github_issue_node_id` text;

ALTER TABLE `feedback_desk_items`
  ADD COLUMN `github_draft_pull_request_url` text;
