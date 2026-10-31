/*
 * Buildertrend staging merge rules: the `ON CONFLICT ... DO UPDATE SET`
 * column assignments used when a replayed manifest meets an existing staging
 * row. They decide which values are first-write-wins evidence, which follow
 * the latest capture, and when a row is flagged as a conflict for review.
 * The store (store.ts) appends them to its upserts; the text is unchanged
 * from the original generator, so replays stay idempotent.
 */

/** Merge assignments for the import run row. */
export const STAGING_RUN_MERGE_SQL = `  source_method = CASE
    WHEN buildertrend_staging_runs.manifest_fingerprint
      = excluded.manifest_fingerprint THEN excluded.source_method
    ELSE buildertrend_staging_runs.source_method
  END,
  source_label = CASE
    WHEN buildertrend_staging_runs.manifest_fingerprint
      = excluded.manifest_fingerprint THEN excluded.source_label
    ELSE buildertrend_staging_runs.source_label
  END,
  status = CASE
    WHEN buildertrend_staging_runs.manifest_fingerprint
      = excluded.manifest_fingerprint THEN 'in_progress'
    ELSE 'manifest_conflict'
  END,
  completed_at = CASE
    WHEN buildertrend_staging_runs.manifest_fingerprint
      = excluded.manifest_fingerprint THEN NULL
    ELSE buildertrend_staging_runs.completed_at
  END,
  raw_artifact_drive_file_id = CASE
    WHEN buildertrend_staging_runs.manifest_fingerprint
      = excluded.manifest_fingerprint THEN COALESCE(
        buildertrend_staging_runs.raw_artifact_drive_file_id,
        excluded.raw_artifact_drive_file_id
      )
    ELSE buildertrend_staging_runs.raw_artifact_drive_file_id
  END,
  raw_artifact_drive_url = CASE
    WHEN buildertrend_staging_runs.manifest_fingerprint
      = excluded.manifest_fingerprint THEN COALESCE(
        buildertrend_staging_runs.raw_artifact_drive_url,
        excluded.raw_artifact_drive_url
      )
    ELSE buildertrend_staging_runs.raw_artifact_drive_url
  END,
  source_notes = CASE
    WHEN buildertrend_staging_runs.manifest_fingerprint
      = excluded.manifest_fingerprint THEN COALESCE(
        buildertrend_staging_runs.source_notes,
        excluded.source_notes
      )
    ELSE buildertrend_staging_runs.source_notes
  END,
  summary_json = CASE
    WHEN buildertrend_staging_runs.manifest_fingerprint
      = excluded.manifest_fingerprint THEN NULL
    ELSE buildertrend_staging_runs.summary_json
  END,
  updated_at = excluded.updated_at;`

/** Merge assignments for a source record. */
export const STAGING_RECORD_MERGE_SQL = `  requested_project_id = CASE
    WHEN buildertrend_staging_records.project_id IS NULL
      THEN COALESCE(
        excluded.requested_project_id,
        buildertrend_staging_records.requested_project_id
      )
    ELSE buildertrend_staging_records.requested_project_id
  END,
  project_id = COALESCE(
    buildertrend_staging_records.project_id,
    excluded.project_id
  ),
  source_scope = excluded.source_scope,
  source_record_type = excluded.source_record_type,
  buildertrend_job_id = COALESCE(
    excluded.buildertrend_job_id,
    buildertrend_staging_records.buildertrend_job_id
  ),
  buildertrend_lead_id = COALESCE(
    excluded.buildertrend_lead_id,
    buildertrend_staging_records.buildertrend_lead_id
  ),
  buildertrend_record_id = COALESCE(
    excluded.buildertrend_record_id,
    buildertrend_staging_records.buildertrend_record_id
  ),
  buildertrend_record_number = COALESCE(
    excluded.buildertrend_record_number,
    buildertrend_staging_records.buildertrend_record_number
  ),
  buildertrend_url = COALESCE(
    excluded.buildertrend_url,
    buildertrend_staging_records.buildertrend_url
  ),
  title = excluded.title,
  record_date = COALESCE(
    excluded.record_date,
    buildertrend_staging_records.record_date
  ),
  record_status = COALESCE(
    excluded.record_status,
    buildertrend_staging_records.record_status
  ),
  source_status = COALESCE(
    excluded.source_status,
    buildertrend_staging_records.source_status
  ),
  department_code = COALESCE(
    excluded.department_code,
    buildertrend_staging_records.department_code
  ),
  client_name = COALESCE(
    excluded.client_name,
    buildertrend_staging_records.client_name
  ),
  contact_name = COALESCE(
    excluded.contact_name,
    buildertrend_staging_records.contact_name
  ),
  contact_email = COALESCE(
    excluded.contact_email,
    buildertrend_staging_records.contact_email
  ),
  amount = COALESCE(excluded.amount, buildertrend_staging_records.amount),
  searchable_text = COALESCE(
    excluded.searchable_text,
    buildertrend_staging_records.searchable_text
  ),
  normalized_summary = COALESCE(
    excluded.normalized_summary,
    buildertrend_staging_records.normalized_summary
  ),
  raw_payload_json = COALESCE(
    excluded.raw_payload_json,
    buildertrend_staging_records.raw_payload_json
  ),
  source_archive_drive_folder_id = COALESCE(
    buildertrend_staging_records.source_archive_drive_folder_id,
    excluded.source_archive_drive_folder_id
  ),
  source_archive_drive_file_id = COALESCE(
    buildertrend_staging_records.source_archive_drive_file_id,
    excluded.source_archive_drive_file_id
  ),
  source_archive_drive_url = COALESCE(
    buildertrend_staging_records.source_archive_drive_url,
    excluded.source_archive_drive_url
  ),
  review_status = CASE
    WHEN excluded.project_id IS NOT NULL
      AND buildertrend_staging_records.project_id IS NOT NULL
      AND excluded.project_id <> buildertrend_staging_records.project_id
      THEN 'reference_conflict'
    WHEN excluded.source_archive_drive_file_id IS NOT NULL
      AND buildertrend_staging_records.source_archive_drive_file_id IS NOT NULL
      AND excluded.source_archive_drive_file_id
        <> buildertrend_staging_records.source_archive_drive_file_id
      THEN 'evidence_conflict'
    WHEN excluded.source_archive_drive_url IS NOT NULL
      AND buildertrend_staging_records.source_archive_drive_url IS NOT NULL
      AND excluded.source_archive_drive_url
        <> buildertrend_staging_records.source_archive_drive_url
      THEN 'evidence_conflict'
    WHEN excluded.source_archive_drive_folder_id IS NOT NULL
      AND buildertrend_staging_records.source_archive_drive_folder_id
        IS NOT NULL
      AND excluded.source_archive_drive_folder_id
        <> buildertrend_staging_records.source_archive_drive_folder_id
      THEN 'evidence_conflict'
    WHEN buildertrend_staging_records.review_status = 'unresolved_reference'
      AND excluded.review_status = 'needs_review'
      THEN 'needs_review'
    ELSE buildertrend_staging_records.review_status
  END,
  source_notes = COALESCE(
    excluded.source_notes,
    buildertrend_staging_records.source_notes
  ),
  updated_at = excluded.updated_at;`

/** Merge assignments for an archive file. */
export const STAGING_FILE_MERGE_SQL = `  requested_source_record_key = CASE
    WHEN buildertrend_staging_files.source_record_id IS NULL
      THEN COALESCE(
        excluded.requested_source_record_key,
        buildertrend_staging_files.requested_source_record_key
      )
    ELSE buildertrend_staging_files.requested_source_record_key
  END,
  source_record_id = COALESCE(
    buildertrend_staging_files.source_record_id,
    excluded.source_record_id
  ),
  requested_project_id = CASE
    WHEN buildertrend_staging_files.project_id IS NULL
      THEN COALESCE(
        excluded.requested_project_id,
        buildertrend_staging_files.requested_project_id
      )
    ELSE buildertrend_staging_files.requested_project_id
  END,
  project_id = COALESCE(buildertrend_staging_files.project_id, excluded.project_id),
  source_scope = excluded.source_scope,
  source_record_type = excluded.source_record_type,
  buildertrend_job_id = COALESCE(
    excluded.buildertrend_job_id,
    buildertrend_staging_files.buildertrend_job_id
  ),
  buildertrend_lead_id = COALESCE(
    excluded.buildertrend_lead_id,
    buildertrend_staging_files.buildertrend_lead_id
  ),
  buildertrend_file_id = COALESCE(
    excluded.buildertrend_file_id,
    buildertrend_staging_files.buildertrend_file_id
  ),
  buildertrend_url = COALESCE(
    excluded.buildertrend_url,
    buildertrend_staging_files.buildertrend_url
  ),
  file_name = excluded.file_name,
  mime_type = COALESCE(excluded.mime_type, buildertrend_staging_files.mime_type),
  file_size = COALESCE(excluded.file_size, buildertrend_staging_files.file_size),
  source_drive_folder_id = COALESCE(
    buildertrend_staging_files.source_drive_folder_id,
    excluded.source_drive_folder_id
  ),
  source_drive_file_id = COALESCE(
    buildertrend_staging_files.source_drive_file_id,
    excluded.source_drive_file_id
  ),
  source_drive_url = COALESCE(
    buildertrend_staging_files.source_drive_url,
    excluded.source_drive_url
  ),
  source_thumbnail_drive_file_id = COALESCE(
    buildertrend_staging_files.source_thumbnail_drive_file_id,
    excluded.source_thumbnail_drive_file_id
  ),
  source_thumbnail_url = COALESCE(
    buildertrend_staging_files.source_thumbnail_url,
    excluded.source_thumbnail_url
  ),
  source_checksum = COALESCE(
    buildertrend_staging_files.source_checksum,
    excluded.source_checksum
  ),
  captured_at = COALESCE(
    excluded.captured_at,
    buildertrend_staging_files.captured_at
  ),
  source_metadata_json = COALESCE(
    excluded.source_metadata_json,
    buildertrend_staging_files.source_metadata_json
  ),
  review_status = CASE
    WHEN excluded.project_id IS NOT NULL
      AND buildertrend_staging_files.project_id IS NOT NULL
      AND excluded.project_id <> buildertrend_staging_files.project_id
      THEN 'reference_conflict'
    WHEN excluded.source_record_id IS NOT NULL
      AND buildertrend_staging_files.source_record_id IS NOT NULL
      AND excluded.source_record_id <> buildertrend_staging_files.source_record_id
      THEN 'reference_conflict'
    WHEN excluded.source_checksum IS NOT NULL
      AND buildertrend_staging_files.source_checksum IS NOT NULL
      AND excluded.source_checksum <> buildertrend_staging_files.source_checksum
      THEN 'evidence_conflict'
    WHEN excluded.source_drive_file_id IS NOT NULL
      AND buildertrend_staging_files.source_drive_file_id IS NOT NULL
      AND excluded.source_drive_file_id
        <> buildertrend_staging_files.source_drive_file_id
      THEN 'evidence_conflict'
    WHEN excluded.source_drive_url IS NOT NULL
      AND buildertrend_staging_files.source_drive_url IS NOT NULL
      AND excluded.source_drive_url <> buildertrend_staging_files.source_drive_url
      THEN 'evidence_conflict'
    WHEN excluded.source_drive_folder_id IS NOT NULL
      AND buildertrend_staging_files.source_drive_folder_id IS NOT NULL
      AND excluded.source_drive_folder_id
        <> buildertrend_staging_files.source_drive_folder_id
      THEN 'evidence_conflict'
    WHEN excluded.source_thumbnail_drive_file_id IS NOT NULL
      AND buildertrend_staging_files.source_thumbnail_drive_file_id IS NOT NULL
      AND excluded.source_thumbnail_drive_file_id
        <> buildertrend_staging_files.source_thumbnail_drive_file_id
      THEN 'evidence_conflict'
    WHEN excluded.source_thumbnail_url IS NOT NULL
      AND buildertrend_staging_files.source_thumbnail_url IS NOT NULL
      AND excluded.source_thumbnail_url
        <> buildertrend_staging_files.source_thumbnail_url
      THEN 'evidence_conflict'
    WHEN buildertrend_staging_files.review_status = 'unresolved_reference'
      AND excluded.review_status = 'needs_review'
      THEN 'needs_review'
    ELSE buildertrend_staging_files.review_status
  END,
  updated_at = excluded.updated_at;`

/** Merge assignments for an access candidate. */
export const STAGING_ACCESS_MERGE_SQL = `  requested_source_record_key = CASE
    WHEN buildertrend_staging_access_candidates.source_record_id IS NULL
      THEN COALESCE(
        excluded.requested_source_record_key,
        buildertrend_staging_access_candidates.requested_source_record_key
      )
    ELSE buildertrend_staging_access_candidates.requested_source_record_key
  END,
  source_record_id = COALESCE(
    buildertrend_staging_access_candidates.source_record_id,
    excluded.source_record_id
  ),
  requested_project_id = CASE
    WHEN buildertrend_staging_access_candidates.project_id IS NULL
      THEN COALESCE(
        excluded.requested_project_id,
        buildertrend_staging_access_candidates.requested_project_id
      )
    ELSE buildertrend_staging_access_candidates.requested_project_id
  END,
  project_id = COALESCE(
    buildertrend_staging_access_candidates.project_id,
    excluded.project_id
  ),
  buildertrend_job_id = COALESCE(
    buildertrend_staging_access_candidates.buildertrend_job_id,
    excluded.buildertrend_job_id
  ),
  buildertrend_lead_id = COALESCE(
    buildertrend_staging_access_candidates.buildertrend_lead_id,
    excluded.buildertrend_lead_id
  ),
  buildertrend_contact_id = COALESCE(
    buildertrend_staging_access_candidates.buildertrend_contact_id,
    excluded.buildertrend_contact_id
  ),
  buildertrend_access_role = COALESCE(
    buildertrend_staging_access_candidates.buildertrend_access_role,
    excluded.buildertrend_access_role
  ),
  contact_name = buildertrend_staging_access_candidates.contact_name,
  company_name = COALESCE(
    buildertrend_staging_access_candidates.company_name,
    excluded.company_name
  ),
  email = COALESCE(
    buildertrend_staging_access_candidates.email,
    excluded.email
  ),
  phone = COALESCE(
    buildertrend_staging_access_candidates.phone,
    excluded.phone
  ),
  proposed_contact_type =
    buildertrend_staging_access_candidates.proposed_contact_type,
  proposed_project_role = COALESCE(
    buildertrend_staging_access_candidates.proposed_project_role,
    excluded.proposed_project_role
  ),
  review_status = CASE
    WHEN excluded.project_id IS NOT NULL
      AND buildertrend_staging_access_candidates.project_id IS NOT NULL
      AND excluded.project_id
        <> buildertrend_staging_access_candidates.project_id
      THEN 'reference_conflict'
    WHEN excluded.source_record_id IS NOT NULL
      AND buildertrend_staging_access_candidates.source_record_id IS NOT NULL
      AND excluded.source_record_id
        <> buildertrend_staging_access_candidates.source_record_id
      THEN 'reference_conflict'
    WHEN excluded.buildertrend_contact_id IS NOT NULL
      AND buildertrend_staging_access_candidates.buildertrend_contact_id
        IS NOT NULL
      AND excluded.buildertrend_contact_id
        <> buildertrend_staging_access_candidates.buildertrend_contact_id
      THEN 'identity_conflict'
    WHEN excluded.buildertrend_job_id IS NOT NULL
      AND buildertrend_staging_access_candidates.buildertrend_job_id IS NOT NULL
      AND excluded.buildertrend_job_id
        <> buildertrend_staging_access_candidates.buildertrend_job_id
      THEN 'identity_conflict'
    WHEN excluded.buildertrend_lead_id IS NOT NULL
      AND buildertrend_staging_access_candidates.buildertrend_lead_id
        IS NOT NULL
      AND excluded.buildertrend_lead_id
        <> buildertrend_staging_access_candidates.buildertrend_lead_id
      THEN 'identity_conflict'
    WHEN excluded.buildertrend_access_role IS NOT NULL
      AND buildertrend_staging_access_candidates.buildertrend_access_role
        IS NOT NULL
      AND excluded.buildertrend_access_role
        <> buildertrend_staging_access_candidates.buildertrend_access_role
      THEN 'identity_conflict'
    WHEN excluded.contact_name
        <> buildertrend_staging_access_candidates.contact_name
      THEN 'identity_conflict'
    WHEN excluded.email IS NOT NULL
      AND buildertrend_staging_access_candidates.email IS NOT NULL
      AND excluded.email <> buildertrend_staging_access_candidates.email
      THEN 'identity_conflict'
    WHEN excluded.company_name IS NOT NULL
      AND buildertrend_staging_access_candidates.company_name IS NOT NULL
      AND excluded.company_name
        <> buildertrend_staging_access_candidates.company_name
      THEN 'identity_conflict'
    WHEN excluded.phone IS NOT NULL
      AND buildertrend_staging_access_candidates.phone IS NOT NULL
      AND excluded.phone <> buildertrend_staging_access_candidates.phone
      THEN 'identity_conflict'
    WHEN excluded.proposed_contact_type
        <> buildertrend_staging_access_candidates.proposed_contact_type
      THEN 'identity_conflict'
    WHEN excluded.proposed_project_role IS NOT NULL
      AND buildertrend_staging_access_candidates.proposed_project_role
        IS NOT NULL
      AND excluded.proposed_project_role
        <> buildertrend_staging_access_candidates.proposed_project_role
      THEN 'identity_conflict'
    WHEN buildertrend_staging_access_candidates.review_status
        = 'unresolved_reference'
      AND excluded.review_status = 'needs_review'
      THEN 'needs_review'
    ELSE buildertrend_staging_access_candidates.review_status
  END,
  source_notes = COALESCE(
    excluded.source_notes,
    buildertrend_staging_access_candidates.source_notes
  ),
  updated_at = excluded.updated_at;`
