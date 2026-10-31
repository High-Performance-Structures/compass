import { STAGING_ACCESS_MERGE_SQL, STAGING_FILE_MERGE_SQL, STAGING_RECORD_MERGE_SQL, STAGING_RUN_MERGE_SQL } from "./merge"
import type { BuildertrendStagingManifest } from "./rules"
import {
  activeRunGuardSql,
  initialReviewStatusSql,
  jsonText,
  scopedProjectId,
  scopedSourceRecordId,
  sqlNumber,
  sqlText,
  stableId,
} from "./sql"

/*
 * The Buildertrend staging store: the only code that inserts into or updates
 * the buildertrend_staging_* tables (architecture standard, section 1).
 * Buildertrend staging is archive and legal-hold evidence, so these builders
 * emit SQL text that an operator applies with Wrangler; nothing here runs a
 * query. Each statement is idempotent: replaying a manifest or the legacy
 * reconciliation never duplicates or overwrites captured evidence.
 */

// ---- Manifest imports (scripts/build-buildertrend-staging-sql.mjs)

export function importRunStartSql(
  organizationId: string,
  manifest: BuildertrendStagingManifest,
  fingerprint: string
): string {
  const id = stableId("run", organizationId, manifest.runKey)

  return `INSERT INTO buildertrend_staging_runs (
  id, organization_id, run_key, manifest_fingerprint, source_method,
  source_label, status,
  started_at, completed_at, raw_artifact_drive_file_id,
  raw_artifact_drive_url, source_notes, summary_json, created_at, updated_at
) VALUES (
  ${sqlText(id)}, ${sqlText(organizationId)}, ${sqlText(manifest.runKey)},
  ${sqlText(fingerprint)}, ${sqlText(manifest.sourceMethod)},
  ${sqlText(manifest.sourceLabel)},
  'in_progress', ${sqlText(manifest.capturedAt)}, NULL,
  ${sqlText(manifest.rawArtifactDriveFileId)},
  ${sqlText(manifest.rawArtifactDriveUrl)}, ${sqlText(manifest.notes)}, NULL,
  ${sqlText(manifest.capturedAt)}, ${sqlText(manifest.capturedAt)}
)
ON CONFLICT(organization_id, run_key) DO UPDATE SET
${STAGING_RUN_MERGE_SQL}`
}

export function sourceRecordSql(
  organizationId: string,
  manifest: BuildertrendStagingManifest,
  fingerprint: string,
  record: BuildertrendStagingManifest["records"][number]
): string {
  const id = stableId("source", organizationId, record.sourceKey)
  const projectId = scopedProjectId(organizationId, record.projectId)
  const reviewStatus = initialReviewStatusSql(organizationId, {
    projectId: record.projectId,
  })

  return `INSERT INTO buildertrend_staging_records (
  id, organization_id, source_key, requested_project_id, project_id,
  source_scope, source_record_type, buildertrend_job_id, buildertrend_lead_id,
  buildertrend_record_id, buildertrend_record_number, buildertrend_url,
  title, record_date, record_status, source_status, department_code,
  client_name, contact_name, contact_email, amount, searchable_text,
  normalized_summary, raw_payload_json, source_archive_drive_folder_id,
  source_archive_drive_file_id, source_archive_drive_url, review_status,
  promotion_status,
  sage_reconciliation_status, source_notes, created_at, updated_at
) SELECT
  ${sqlText(id)}, ${sqlText(organizationId)}, ${sqlText(record.sourceKey)},
  ${sqlText(record.projectId)}, ${projectId}, ${sqlText(record.sourceScope)},
  ${sqlText(record.sourceRecordType)}, ${sqlText(record.buildertrendJobId)},
  ${sqlText(record.buildertrendLeadId)},
  ${sqlText(record.buildertrendRecordId)},
  ${sqlText(record.buildertrendRecordNumber)},
  ${sqlText(record.buildertrendUrl)}, ${sqlText(record.title)},
  ${sqlText(record.recordDate)}, ${sqlText(record.recordStatus)},
  ${sqlText(record.sourceStatus)}, ${sqlText(record.departmentCode)},
  ${sqlText(record.clientName)}, ${sqlText(record.contactName)},
  ${sqlText(record.contactEmail)}, ${sqlNumber(record.amount)},
  ${sqlText(record.searchableText)}, ${sqlText(record.normalizedSummary)},
  ${jsonText(record.rawPayload)}, ${sqlText(record.archiveDriveFolderId)},
  ${sqlText(record.archiveDriveFileId)}, ${sqlText(record.archiveDriveUrl)},
  ${reviewStatus}, 'archive_only', 'not_reviewed',
  ${sqlText(record.notes)}, ${sqlText(manifest.capturedAt)},
  ${sqlText(manifest.capturedAt)}
WHERE ${activeRunGuardSql(organizationId, manifest, fingerprint)}
ON CONFLICT(organization_id, source_key) DO UPDATE SET
${STAGING_RECORD_MERGE_SQL}`
}

export function archiveFileSql(
  organizationId: string,
  manifest: BuildertrendStagingManifest,
  fingerprint: string,
  file: BuildertrendStagingManifest["files"][number]
): string {
  const id = stableId("file", organizationId, file.sourceKey)
  const reference = {
    projectId: file.projectId,
    sourceRecordKey: file.sourceRecordKey,
  }
  const projectId = scopedProjectId(organizationId, file.projectId)
  const sourceRecordId = scopedSourceRecordId(organizationId, reference)
  const reviewStatus = initialReviewStatusSql(organizationId, reference)

  return `INSERT INTO buildertrend_staging_files (
  id, organization_id, source_key, requested_source_record_key,
  source_record_id, requested_project_id, project_id, source_scope,
  source_record_type, buildertrend_job_id, buildertrend_lead_id,
  buildertrend_file_id, buildertrend_url, file_name, mime_type, file_size,
  source_drive_folder_id, source_drive_file_id, source_drive_url,
  source_thumbnail_drive_file_id, source_thumbnail_url, source_checksum,
  captured_at, visibility, review_status, source_metadata_json, created_at,
  updated_at
) SELECT
  ${sqlText(id)}, ${sqlText(organizationId)}, ${sqlText(file.sourceKey)},
  ${sqlText(file.sourceRecordKey)}, ${sourceRecordId},
  ${sqlText(file.projectId)}, ${projectId}, ${sqlText(file.sourceScope)},
  ${sqlText(file.sourceRecordType)}, ${sqlText(file.buildertrendJobId)},
  ${sqlText(file.buildertrendLeadId)}, ${sqlText(file.buildertrendFileId)},
  ${sqlText(file.buildertrendUrl)}, ${sqlText(file.fileName)},
  ${sqlText(file.mimeType)}, ${sqlNumber(file.fileSize)},
  ${sqlText(file.driveFolderId)}, ${sqlText(file.driveFileId)},
  ${sqlText(file.driveUrl)}, ${sqlText(file.thumbnailDriveFileId)},
  ${sqlText(file.thumbnailUrl)}, ${sqlText(file.checksum)},
  ${sqlText(file.capturedAt ?? manifest.capturedAt)}, 'internal',
  ${reviewStatus}, ${jsonText(file.metadata)},
  ${sqlText(manifest.capturedAt)}, ${sqlText(manifest.capturedAt)}
WHERE ${activeRunGuardSql(organizationId, manifest, fingerprint)}
ON CONFLICT(organization_id, source_key) DO UPDATE SET
${STAGING_FILE_MERGE_SQL}`
}

export function accessCandidateSql(
  organizationId: string,
  manifest: BuildertrendStagingManifest,
  fingerprint: string,
  candidate: BuildertrendStagingManifest["accessCandidates"][number]
): string {
  const id = stableId("access", organizationId, candidate.sourceKey)
  const reference = {
    projectId: candidate.projectId,
    sourceRecordKey: candidate.sourceRecordKey,
  }
  const projectId = scopedProjectId(organizationId, candidate.projectId)
  const sourceRecordId = scopedSourceRecordId(organizationId, reference)
  const reviewStatus = initialReviewStatusSql(organizationId, reference)

  return `INSERT INTO buildertrend_staging_access_candidates (
  id, organization_id, source_key, requested_source_record_key,
  source_record_id, requested_project_id, project_id, buildertrend_job_id,
  buildertrend_lead_id, buildertrend_contact_id, buildertrend_access_role,
  contact_name, company_name, email, phone, proposed_contact_type,
  proposed_project_role, match_status, match_confidence, portal_access_status,
  review_status, source_notes, created_at, updated_at
) SELECT
  ${sqlText(id)}, ${sqlText(organizationId)}, ${sqlText(candidate.sourceKey)},
  ${sqlText(candidate.sourceRecordKey)}, ${sourceRecordId},
  ${sqlText(candidate.projectId)}, ${projectId},
  ${sqlText(candidate.buildertrendJobId)},
  ${sqlText(candidate.buildertrendLeadId)},
  ${sqlText(candidate.buildertrendContactId)},
  ${sqlText(candidate.buildertrendAccessRole)},
  ${sqlText(candidate.contactName)}, ${sqlText(candidate.companyName)},
  ${sqlText(candidate.email)}, ${sqlText(candidate.phone)},
  ${sqlText(candidate.proposedContactType)},
  ${sqlText(candidate.proposedProjectRole)}, 'unmatched', 0, 'not_granted',
  ${reviewStatus}, ${sqlText(candidate.notes)},
  ${sqlText(manifest.capturedAt)}, ${sqlText(manifest.capturedAt)}
WHERE ${activeRunGuardSql(organizationId, manifest, fingerprint)}
ON CONFLICT(organization_id, source_key) DO UPDATE SET
${STAGING_ACCESS_MERGE_SQL}`
}

export function observationSql(
  organizationId: string,
  manifest: BuildertrendStagingManifest,
  fingerprint: string,
  entityKind: "record" | "file" | "access_candidate",
  entityKey: string,
  entityId: string,
  observedPayload: unknown
): string {
  const runId = stableId("run", organizationId, manifest.runKey)
  const observationKey = `${manifest.runKey}:${entityKind}:${entityKey}`
  const id = stableId("observation", organizationId, observationKey)

  return `INSERT INTO buildertrend_staging_observations (
  id, import_run_id, organization_id, entity_kind, entity_key, entity_id,
  observed_payload_json, observed_at
) SELECT
  ${sqlText(id)}, ${sqlText(runId)}, ${sqlText(organizationId)},
  ${sqlText(entityKind)}, ${sqlText(entityKey)}, ${sqlText(entityId)},
  ${jsonText(observedPayload)},
  ${sqlText(manifest.capturedAt)}
WHERE ${activeRunGuardSql(organizationId, manifest, fingerprint)}
ON CONFLICT(import_run_id, entity_kind, entity_key) DO NOTHING;`
}

export function parentChildInvariantSql(
  organizationId: string,
  manifest: BuildertrendStagingManifest,
  fingerprint: string
): readonly string[] {
  const guard = activeRunGuardSql(organizationId, manifest, fingerprint)
  return [
    `UPDATE buildertrend_staging_files
SET review_status = 'reference_conflict'
WHERE organization_id = ${sqlText(organizationId)}
  AND project_id IS NOT NULL
  AND source_record_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM buildertrend_staging_records parent
    WHERE parent.id = buildertrend_staging_files.source_record_id
      AND parent.project_id IS NOT NULL
      AND parent.project_id <> buildertrend_staging_files.project_id
  )
  AND ${guard};`,
    `UPDATE buildertrend_staging_access_candidates
SET review_status = 'reference_conflict'
WHERE organization_id = ${sqlText(organizationId)}
  AND project_id IS NOT NULL
  AND source_record_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM buildertrend_staging_records parent
    WHERE parent.id = buildertrend_staging_access_candidates.source_record_id
      AND parent.project_id IS NOT NULL
      AND parent.project_id
        <> buildertrend_staging_access_candidates.project_id
  )
  AND ${guard};`,
  ]
}

export function importRunFinalizeSql(
  organizationId: string,
  manifest: BuildertrendStagingManifest,
  fingerprint: string
): string {
  const runId = stableId("run", organizationId, manifest.runKey)

  return `UPDATE buildertrend_staging_runs
SET
  status = 'completed',
  completed_at = ${sqlText(manifest.capturedAt)},
  summary_json = json_object(
    'records',
    (SELECT COUNT(*) FROM buildertrend_staging_observations
      WHERE import_run_id = ${sqlText(runId)} AND entity_kind = 'record'),
    'files',
    (SELECT COUNT(*) FROM buildertrend_staging_observations
      WHERE import_run_id = ${sqlText(runId)} AND entity_kind = 'file'),
    'accessCandidates',
    (SELECT COUNT(*) FROM buildertrend_staging_observations
      WHERE import_run_id = ${sqlText(
        runId
      )} AND entity_kind = 'access_candidate'),
    'unresolvedOrConflicted',
    (
      SELECT
        (SELECT COUNT(*) FROM buildertrend_staging_records r
          JOIN buildertrend_staging_observations o ON o.entity_id = r.id
          WHERE o.import_run_id = ${sqlText(runId)}
            AND o.entity_kind = 'record'
            AND r.review_status IN (
              'unresolved_reference',
              'reference_conflict',
              'evidence_conflict'
            ))
        +
        (SELECT COUNT(*) FROM buildertrend_staging_files f
          JOIN buildertrend_staging_observations o ON o.entity_id = f.id
          WHERE o.import_run_id = ${sqlText(runId)}
            AND o.entity_kind = 'file'
            AND f.review_status IN (
              'unresolved_reference',
              'reference_conflict',
              'evidence_conflict'
            ))
        +
        (SELECT COUNT(*) FROM buildertrend_staging_access_candidates a
          JOIN buildertrend_staging_observations o ON o.entity_id = a.id
          WHERE o.import_run_id = ${sqlText(runId)}
            AND o.entity_kind = 'access_candidate'
            AND a.review_status IN (
              'unresolved_reference',
              'reference_conflict',
              'identity_conflict'
            ))
    ),
    'relationshipConflicts',
    (
      (SELECT COUNT(*) FROM buildertrend_staging_files f
        JOIN buildertrend_staging_records parent
          ON parent.id = f.source_record_id
        JOIN buildertrend_staging_observations o
          ON o.entity_id = parent.id AND o.entity_kind = 'record'
        WHERE o.import_run_id = ${sqlText(runId)}
          AND f.project_id IS NOT NULL
          AND parent.project_id IS NOT NULL
          AND f.project_id <> parent.project_id)
      +
      (SELECT COUNT(*) FROM buildertrend_staging_access_candidates a
        JOIN buildertrend_staging_records parent
          ON parent.id = a.source_record_id
        JOIN buildertrend_staging_observations o
          ON o.entity_id = parent.id AND o.entity_kind = 'record'
        WHERE o.import_run_id = ${sqlText(runId)}
          AND a.project_id IS NOT NULL
          AND parent.project_id IS NOT NULL
          AND a.project_id <> parent.project_id)
    )
  ),
  updated_at = ${sqlText(manifest.capturedAt)}
WHERE id = ${sqlText(runId)}
  AND organization_id = ${sqlText(organizationId)}
  AND manifest_fingerprint = ${sqlText(fingerprint)}
  AND status = 'in_progress';`
}

// ---- Legacy 0062 -> 0084 reconciliation (scripts/build-buildertrend-legacy-reconciliation-sql.mjs)

/** Copies legacy rows into buildertrend_staging_runs; existing staging rows are left untouched. */
export function legacyRunsInsertSql(sourceSql: string): string {
  return `INSERT OR IGNORE INTO buildertrend_staging_runs (
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
${sourceSql}`
}

/** Copies legacy rows into buildertrend_staging_records; existing staging rows are left untouched. */
export function legacyRecordsInsertSql(sourceSql: string): string {
  return `INSERT OR IGNORE INTO buildertrend_staging_records (
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
${sourceSql}`
}

/** Copies legacy rows into buildertrend_staging_files; existing staging rows are left untouched. */
export function legacyFilesInsertSql(sourceSql: string): string {
  return `INSERT OR IGNORE INTO buildertrend_staging_files (
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
${sourceSql}`
}

/** Copies legacy rows into buildertrend_staging_access_candidates; existing staging rows are left untouched. */
export function legacyAccessCandidatesInsertSql(sourceSql: string): string {
  return `INSERT OR IGNORE INTO buildertrend_staging_access_candidates (
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
${sourceSql}`
}

/** Copies legacy rows into buildertrend_staging_observations; existing staging rows are left untouched. */
export function legacyObservationsInsertSql(sourceSql: string): string {
  return `INSERT OR IGNORE INTO buildertrend_staging_observations (
  id,
  import_run_id,
  organization_id,
  entity_kind,
  entity_key,
  entity_id,
  observed_payload_json,
  observed_at
)
${sourceSql}`
}
