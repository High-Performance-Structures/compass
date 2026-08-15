function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Builds an idempotent, archive-only bridge from the abandoned 0062 tables to
 * the guarded 0084 Buildertrend staging model. Operational Compass tables are
 * deliberately outside the scope of this reconciliation.
 */
export function buildLegacyBuildertrendReconciliationSql(
  defaultOrganizationId: string
): string {
  const organizationId = defaultOrganizationId.trim()
  if (organizationId.length === 0) {
    throw new Error("A default organization ID is required")
  }

  const defaultOrg = sqlText(organizationId)
  return `-- Fail closed before any durable write. A CHECK violation stops the
-- batch instead of merely returning an error-looking value to the caller.
DROP TABLE IF EXISTS temp.buildertrend_reconciliation_guard;
CREATE TEMP TABLE buildertrend_reconciliation_guard (
  check_name TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);
INSERT INTO buildertrend_reconciliation_guard (check_name, valid)
SELECT 'selected organization exists',
  CASE WHEN (SELECT COUNT(*) FROM organizations WHERE id = ${defaultOrg}) = 1
    THEN 1 ELSE 0 END;

-- File/access conflicts abort. Record conflicts are quarantined below using the
-- linked project's tenant because one historical sample job was stamped with
-- the production tenant while belonging to a separate demo workspace.
INSERT INTO buildertrend_reconciliation_guard (check_name, valid)
SELECT 'file tenant evidence is consistent', CASE WHEN NOT EXISTS (
    SELECT 1
    FROM buildertrend_archive_files source_file
    LEFT JOIN projects file_project ON file_project.id = source_file.project_id
    LEFT JOIN buildertrend_source_records source_record
      ON source_record.id = source_file.source_record_id
    LEFT JOIN projects record_project ON record_project.id = source_record.project_id
    WHERE (source_file.project_id IS NOT NULL AND file_project.id IS NULL)
      OR (source_file.source_record_id IS NOT NULL AND source_record.id IS NULL)
      OR (file_project.organization_id IS NOT NULL
        AND record_project.organization_id IS NOT NULL
        AND file_project.organization_id <> record_project.organization_id)
      OR (source_file.organization_id IS NOT NULL
        AND COALESCE(file_project.organization_id, record_project.organization_id) IS NOT NULL
        AND source_file.organization_id <>
          COALESCE(file_project.organization_id, record_project.organization_id))
      OR (source_record.organization_id IS NOT NULL
        AND record_project.organization_id IS NOT NULL
        AND source_record.organization_id <> record_project.organization_id)
  ) THEN 1 ELSE 0 END;

INSERT INTO buildertrend_reconciliation_guard (check_name, valid)
SELECT 'access tenant evidence is consistent', CASE WHEN NOT EXISTS (
    SELECT 1
    FROM buildertrend_access_candidates source_access
    LEFT JOIN projects access_project ON access_project.id = source_access.project_id
    LEFT JOIN buildertrend_source_records source_record
      ON source_record.id = source_access.source_record_id
    LEFT JOIN projects record_project ON record_project.id = source_record.project_id
    WHERE (source_access.project_id IS NOT NULL AND access_project.id IS NULL)
      OR (source_access.source_record_id IS NOT NULL AND source_record.id IS NULL)
      OR (access_project.organization_id IS NOT NULL
        AND record_project.organization_id IS NOT NULL
        AND access_project.organization_id <> record_project.organization_id)
      OR (source_access.organization_id IS NOT NULL
        AND COALESCE(access_project.organization_id, record_project.organization_id) IS NOT NULL
        AND source_access.organization_id <>
          COALESCE(access_project.organization_id, record_project.organization_id))
      OR (source_record.organization_id IS NOT NULL
        AND record_project.organization_id IS NOT NULL
        AND source_record.organization_id <> record_project.organization_id)
  ) THEN 1 ELSE 0 END;

INSERT OR IGNORE INTO buildertrend_staging_runs (
  id,
  organization_id,
  run_key,
  manifest_fingerprint,
  source_method,
  source_label,
  status,
  started_by,
  started_at,
  completed_at,
  raw_artifact_drive_file_id,
  raw_artifact_drive_url,
  source_notes,
  summary_json,
  created_at,
  updated_at
)
WITH run_org AS (
  SELECT id AS legacy_run_id, COALESCE(organization_id, ${defaultOrg}) AS organization_id
  FROM buildertrend_import_runs
  UNION
  SELECT source_record.import_run_id,
    COALESCE(project.organization_id, source_record.organization_id, ${defaultOrg})
  FROM buildertrend_source_records source_record
  LEFT JOIN projects project ON project.id = source_record.project_id
  UNION
  SELECT source_file.import_run_id,
    COALESCE(
      file_project.organization_id,
      source_file.organization_id,
      record_project.organization_id,
      source_record.organization_id,
      ${defaultOrg}
    )
  FROM buildertrend_archive_files source_file
  LEFT JOIN projects file_project ON file_project.id = source_file.project_id
  LEFT JOIN buildertrend_source_records source_record
    ON source_record.id = source_file.source_record_id
  LEFT JOIN projects record_project ON record_project.id = source_record.project_id
  UNION
  SELECT source_access.import_run_id,
    COALESCE(
      access_project.organization_id,
      source_access.organization_id,
      record_project.organization_id,
      source_record.organization_id,
      ${defaultOrg}
    )
  FROM buildertrend_access_candidates source_access
  LEFT JOIN projects access_project ON access_project.id = source_access.project_id
  LEFT JOIN buildertrend_source_records source_record
    ON source_record.id = source_access.source_record_id
  LEFT JOIN projects record_project ON record_project.id = source_record.project_id
)
SELECT
  'legacy-run:' || source_run.id || ':' || run_org.organization_id,
  run_org.organization_id,
  'legacy-run:' || source_run.id,
  'legacy-reconciliation-v1:' || source_run.id || ':' ||
    run_org.organization_id || ':' || source_run.updated_at,
  source_run.source_method,
  source_run.source_label,
  source_run.status,
  source_run.started_by,
  source_run.started_at,
  source_run.completed_at,
  source_run.raw_artifact_drive_file_id,
  source_run.raw_artifact_drive_url,
  trim(COALESCE(source_run.notes || char(10), '') ||
    'Reconciled from legacy Buildertrend staging run ' || source_run.id),
  source_run.summary_json,
  source_run.created_at,
  source_run.updated_at
FROM buildertrend_import_runs source_run
JOIN run_org ON run_org.legacy_run_id = source_run.id;

INSERT OR IGNORE INTO buildertrend_staging_records (
  id,
  organization_id,
  source_key,
  requested_project_id,
  project_id,
  source_scope,
  source_record_type,
  buildertrend_job_id,
  buildertrend_lead_id,
  buildertrend_record_id,
  buildertrend_record_number,
  buildertrend_url,
  title,
  record_date,
  record_status,
  source_status,
  department_code,
  client_name,
  contact_name,
  contact_email,
  amount,
  searchable_text,
  normalized_summary,
  raw_payload_json,
  source_archive_drive_folder_id,
  source_archive_drive_file_id,
  source_archive_drive_url,
  verified_archive_drive_folder_id,
  verified_archive_drive_file_id,
  verified_archive_drive_url,
  review_status,
  promotion_status,
  promoted_record_type,
  promoted_record_id,
  sage_reconciliation_status,
  source_notes,
  created_at,
  updated_at
)
SELECT
  'legacy-record:' || source_record.id,
  COALESCE(project.organization_id, source_record.organization_id, ${defaultOrg}),
  'legacy-record:' || source_record.id,
  source_record.project_id,
  source_record.project_id,
  source_record.source_scope,
  source_record.source_record_type,
  source_record.buildertrend_job_id,
  source_record.buildertrend_lead_id,
  source_record.buildertrend_record_id,
  source_record.buildertrend_record_number,
  source_record.buildertrend_url,
  source_record.title,
  source_record.record_date,
  source_record.record_status,
  source_record.source_status,
  source_record.department_code,
  source_record.client_name,
  source_record.contact_name,
  source_record.contact_email,
  source_record.amount,
  source_record.searchable_text,
  source_record.normalized_summary,
  source_record.raw_payload_json,
  source_record.archive_drive_folder_id,
  source_record.archive_drive_file_id,
  source_record.archive_drive_url,
  CASE WHEN source_record.review_status = 'verified'
      AND NOT (
        source_record.organization_id IS NOT NULL
        AND project.organization_id IS NOT NULL
        AND source_record.organization_id <> project.organization_id
      )
    THEN source_record.archive_drive_folder_id END,
  CASE WHEN source_record.review_status = 'verified'
      AND NOT (
        source_record.organization_id IS NOT NULL
        AND project.organization_id IS NOT NULL
        AND source_record.organization_id <> project.organization_id
      )
    THEN source_record.archive_drive_file_id END,
  CASE WHEN source_record.review_status = 'verified'
      AND NOT (
        source_record.organization_id IS NOT NULL
        AND project.organization_id IS NOT NULL
        AND source_record.organization_id <> project.organization_id
      )
    THEN source_record.archive_drive_url END,
  CASE WHEN source_record.organization_id IS NOT NULL
      AND project.organization_id IS NOT NULL
      AND source_record.organization_id <> project.organization_id
    THEN 'unresolved_reference'
    ELSE source_record.review_status
  END,
  CASE WHEN source_record.organization_id IS NOT NULL
      AND project.organization_id IS NOT NULL
      AND source_record.organization_id <> project.organization_id
    THEN 'archive_only'
    ELSE source_record.promotion_status
  END,
  source_record.promoted_record_type,
  source_record.promoted_record_id,
  source_record.sage_reconciliation_status,
  trim(COALESCE(source_record.notes || char(10), '') ||
    'Legacy source record: ' || source_record.id ||
    '; legacy run: ' || source_record.import_run_id ||
    CASE WHEN source_record.organization_id IS NOT NULL
        AND project.organization_id IS NOT NULL
        AND source_record.organization_id <> project.organization_id
      THEN '; quarantined tenant conflict: source=' ||
        source_record.organization_id || ', project=' || project.organization_id
      ELSE ''
    END),
  source_record.created_at,
  source_record.updated_at
FROM buildertrend_source_records source_record
LEFT JOIN projects project ON project.id = source_record.project_id;

INSERT OR IGNORE INTO buildertrend_staging_files (
  id,
  organization_id,
  source_key,
  requested_source_record_key,
  source_record_id,
  requested_project_id,
  project_id,
  source_scope,
  source_record_type,
  buildertrend_job_id,
  buildertrend_lead_id,
  buildertrend_file_id,
  buildertrend_url,
  file_name,
  mime_type,
  file_size,
  source_drive_folder_id,
  source_drive_file_id,
  source_drive_url,
  source_thumbnail_drive_file_id,
  source_thumbnail_url,
  verified_drive_folder_id,
  verified_drive_file_id,
  verified_drive_url,
  verified_thumbnail_drive_file_id,
  verified_thumbnail_url,
  source_checksum,
  verified_checksum,
  captured_at,
  visibility,
  review_status,
  source_metadata_json,
  created_at,
  updated_at
)
SELECT
  'legacy-file:' || source_file.id,
  COALESCE(
    file_project.organization_id,
    source_file.organization_id,
    record_project.organization_id,
    source_record.organization_id,
    ${defaultOrg}
  ),
  'legacy-file:' || source_file.id,
  CASE WHEN source_file.source_record_id IS NOT NULL
    THEN 'legacy-record:' || source_file.source_record_id END,
  CASE WHEN source_file.source_record_id IS NOT NULL
    THEN 'legacy-record:' || source_file.source_record_id END,
  source_file.project_id,
  source_file.project_id,
  source_file.source_scope,
  source_file.source_record_type,
  source_file.buildertrend_job_id,
  source_file.buildertrend_lead_id,
  source_file.buildertrend_file_id,
  source_file.buildertrend_url,
  source_file.file_name,
  source_file.mime_type,
  source_file.file_size,
  source_file.drive_folder_id,
  source_file.drive_file_id,
  source_file.drive_url,
  source_file.thumbnail_drive_file_id,
  source_file.thumbnail_url,
  CASE WHEN source_file.review_status IN ('approved', 'verified')
    THEN source_file.drive_folder_id END,
  CASE WHEN source_file.review_status IN ('approved', 'verified')
    THEN source_file.drive_file_id END,
  CASE WHEN source_file.review_status IN ('approved', 'verified')
    THEN source_file.drive_url END,
  CASE WHEN source_file.review_status IN ('approved', 'verified')
    THEN source_file.thumbnail_drive_file_id END,
  CASE WHEN source_file.review_status IN ('approved', 'verified')
    THEN source_file.thumbnail_url END,
  source_file.checksum,
  CASE WHEN source_file.review_status IN ('approved', 'verified')
    THEN source_file.checksum END,
  source_file.captured_at,
  source_file.visibility,
  source_file.review_status,
  json_object(
    'legacyId', source_file.id,
    'legacyImportRunId', source_file.import_run_id,
    'legacyMetadata', CASE
      WHEN json_valid(source_file.metadata_json) THEN json(source_file.metadata_json)
      ELSE source_file.metadata_json
    END
  ),
  source_file.created_at,
  source_file.updated_at
FROM buildertrend_archive_files source_file
LEFT JOIN projects file_project ON file_project.id = source_file.project_id
LEFT JOIN buildertrend_source_records source_record
  ON source_record.id = source_file.source_record_id
LEFT JOIN projects record_project ON record_project.id = source_record.project_id;

INSERT OR IGNORE INTO buildertrend_staging_access_candidates (
  id,
  organization_id,
  source_key,
  requested_source_record_key,
  source_record_id,
  requested_project_id,
  project_id,
  buildertrend_job_id,
  buildertrend_lead_id,
  buildertrend_contact_id,
  buildertrend_access_role,
  contact_name,
  company_name,
  email,
  phone,
  proposed_contact_type,
  proposed_project_role,
  match_status,
  match_confidence,
  portal_access_status,
  review_status,
  source_notes,
  created_at,
  updated_at
)
SELECT
  'legacy-access:' || source_access.id,
  COALESCE(
    access_project.organization_id,
    source_access.organization_id,
    record_project.organization_id,
    source_record.organization_id,
    ${defaultOrg}
  ),
  'legacy-access:' || source_access.id,
  CASE WHEN source_access.source_record_id IS NOT NULL
    THEN 'legacy-record:' || source_access.source_record_id END,
  CASE WHEN source_access.source_record_id IS NOT NULL
    THEN 'legacy-record:' || source_access.source_record_id END,
  source_access.project_id,
  source_access.project_id,
  source_access.buildertrend_job_id,
  source_access.buildertrend_lead_id,
  source_access.buildertrend_contact_id,
  source_access.buildertrend_access_role,
  source_access.contact_name,
  source_access.company_name,
  source_access.email,
  source_access.phone,
  source_access.proposed_contact_type,
  source_access.proposed_project_role,
  'unmatched',
  0,
  'not_granted',
  source_access.review_status,
  trim(COALESCE(source_access.notes || char(10), '') ||
    'Legacy access candidate: ' || source_access.id ||
    '; prior match status: ' || source_access.match_status ||
    '; prior portal status: ' || source_access.portal_access_status),
  source_access.created_at,
  source_access.updated_at
FROM buildertrend_access_candidates source_access
LEFT JOIN projects access_project ON access_project.id = source_access.project_id
LEFT JOIN buildertrend_source_records source_record
  ON source_record.id = source_access.source_record_id
LEFT JOIN projects record_project ON record_project.id = source_record.project_id;

INSERT OR IGNORE INTO buildertrend_staging_observations (
  id,
  import_run_id,
  organization_id,
  entity_kind,
  entity_key,
  entity_id,
  observed_payload_json,
  observed_at
)
SELECT
  'legacy-observation:record:' || source_record.id,
  'legacy-run:' || source_record.import_run_id || ':' ||
    COALESCE(project.organization_id, source_record.organization_id, ${defaultOrg}),
  COALESCE(project.organization_id, source_record.organization_id, ${defaultOrg}),
  'record',
  'legacy-record:' || source_record.id,
  'legacy-record:' || source_record.id,
  json_object(
    'legacyTable', 'buildertrend_source_records',
    'legacyId', source_record.id,
    'legacyImportRunId', source_record.import_run_id,
    'sourceKey', 'legacy-record:' || source_record.id
  ),
  source_record.updated_at
FROM buildertrend_source_records source_record
LEFT JOIN projects project ON project.id = source_record.project_id;

INSERT OR IGNORE INTO buildertrend_staging_observations (
  id,
  import_run_id,
  organization_id,
  entity_kind,
  entity_key,
  entity_id,
  observed_payload_json,
  observed_at
)
SELECT
  'legacy-observation:file:' || source_file.id,
  'legacy-run:' || source_file.import_run_id || ':' ||
    COALESCE(
      file_project.organization_id,
      source_file.organization_id,
      record_project.organization_id,
      source_record.organization_id,
      ${defaultOrg}
    ),
  COALESCE(
    file_project.organization_id,
    source_file.organization_id,
    record_project.organization_id,
    source_record.organization_id,
    ${defaultOrg}
  ),
  'file',
  'legacy-file:' || source_file.id,
  'legacy-file:' || source_file.id,
  json_object(
    'legacyTable', 'buildertrend_archive_files',
    'legacyId', source_file.id,
    'legacyImportRunId', source_file.import_run_id,
    'sourceKey', 'legacy-file:' || source_file.id
  ),
  source_file.updated_at
FROM buildertrend_archive_files source_file
LEFT JOIN projects file_project ON file_project.id = source_file.project_id
LEFT JOIN buildertrend_source_records source_record
  ON source_record.id = source_file.source_record_id
LEFT JOIN projects record_project ON record_project.id = source_record.project_id;

INSERT OR IGNORE INTO buildertrend_staging_observations (
  id,
  import_run_id,
  organization_id,
  entity_kind,
  entity_key,
  entity_id,
  observed_payload_json,
  observed_at
)
SELECT
  'legacy-observation:access:' || source_access.id,
  'legacy-run:' || source_access.import_run_id || ':' ||
    COALESCE(
      access_project.organization_id,
      source_access.organization_id,
      record_project.organization_id,
      source_record.organization_id,
      ${defaultOrg}
    ),
  COALESCE(
    access_project.organization_id,
    source_access.organization_id,
    record_project.organization_id,
    source_record.organization_id,
    ${defaultOrg}
  ),
  'access_candidate',
  'legacy-access:' || source_access.id,
  'legacy-access:' || source_access.id,
  json_object(
    'legacyTable', 'buildertrend_access_candidates',
    'legacyId', source_access.id,
    'legacyImportRunId', source_access.import_run_id,
    'sourceKey', 'legacy-access:' || source_access.id
  ),
  source_access.updated_at
FROM buildertrend_access_candidates source_access
LEFT JOIN projects access_project ON access_project.id = source_access.project_id
LEFT JOIN buildertrend_source_records source_record
  ON source_record.id = source_access.source_record_id
LEFT JOIN projects record_project ON record_project.id = source_record.project_id;

DROP TABLE temp.buildertrend_reconciliation_guard;
`
}
