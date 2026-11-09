CREATE TABLE IF NOT EXISTS `job_email_delivery_settings` (
  `organization_id` text PRIMARY KEY NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `insurance_agent_email` text,
  `w9_version` text,
  `w9_filename` text,
  `w9_pdf` blob
);
