-- Preserved external-system chronology can be staged before its photo arrives.
-- Keep source dates separate from EXIF capture and Compass import timestamps.
CREATE TABLE IF NOT EXISTS `project_photo_source_dates` (
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `source_system` text NOT NULL,
  `source_external_id` text NOT NULL,
  `source_date` text NOT NULL,
  `source_date_kind` text NOT NULL,
  `source_date_display` text NOT NULL,
  `evidence_json` text NOT NULL,
  `recorded_at` text NOT NULL,
  PRIMARY KEY (`project_id`, `source_system`, `source_external_id`)
);
