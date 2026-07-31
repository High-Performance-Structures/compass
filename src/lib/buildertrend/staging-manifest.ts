import { z } from "zod/v4"

const optionalText = z.string().trim().min(1).optional()
const nullableText = z.string().trim().min(1).nullable().optional()

const sourceRecordSchema = z
  .object({
    sourceKey: z.string().trim().min(1),
    projectId: optionalText,
    sourceScope: z.string().trim().min(1).default("job"),
    sourceRecordType: z.string().trim().min(1),
    buildertrendJobId: optionalText,
    buildertrendLeadId: optionalText,
    buildertrendRecordId: optionalText,
    buildertrendRecordNumber: optionalText,
    buildertrendUrl: optionalText,
    title: z.string().trim().min(1),
    recordDate: optionalText,
    recordStatus: optionalText,
    sourceStatus: optionalText,
    departmentCode: optionalText,
    clientName: optionalText,
    contactName: optionalText,
    contactEmail: optionalText,
    amount: z.number().finite().optional(),
    searchableText: optionalText,
    normalizedSummary: optionalText,
    rawPayload: z.unknown().optional(),
    archiveDriveFolderId: optionalText,
    archiveDriveFileId: optionalText,
    archiveDriveUrl: optionalText,
    notes: optionalText,
  })
  .strict()

const archiveFileSchema = z
  .object({
    sourceKey: z.string().trim().min(1),
    sourceRecordKey: optionalText,
    projectId: optionalText,
    sourceScope: z.string().trim().min(1).default("job"),
    sourceRecordType: z.string().trim().min(1),
    buildertrendJobId: optionalText,
    buildertrendLeadId: optionalText,
    buildertrendFileId: optionalText,
    buildertrendUrl: optionalText,
    fileName: z.string().trim().min(1),
    mimeType: optionalText,
    fileSize: z.number().int().nonnegative().optional(),
    driveFolderId: optionalText,
    driveFileId: optionalText,
    driveUrl: optionalText,
    thumbnailDriveFileId: optionalText,
    thumbnailUrl: optionalText,
    checksum: optionalText,
    capturedAt: optionalText,
    metadata: z.unknown().optional(),
  })
  .strict()

const accessCandidateSchema = z
  .object({
    sourceKey: z.string().trim().min(1),
    sourceRecordKey: optionalText,
    projectId: optionalText,
    buildertrendJobId: optionalText,
    buildertrendLeadId: optionalText,
    buildertrendContactId: optionalText,
    buildertrendAccessRole: optionalText,
    contactName: z.string().trim().min(1),
    companyName: nullableText,
    email: nullableText,
    phone: nullableText,
    proposedContactType: z.string().trim().min(1).default("vendor"),
    proposedProjectRole: nullableText,
    notes: nullableText,
  })
  .strict()

export const buildertrendStagingManifestSchema = z
  .object({
    runKey: z.string().trim().min(1),
    sourceMethod: z.string().trim().min(1),
    sourceLabel: z.string().trim().min(1),
    capturedAt: z.iso.datetime({ offset: true }),
    rawArtifactDriveFileId: optionalText,
    rawArtifactDriveUrl: optionalText,
    notes: optionalText,
    records: z.array(sourceRecordSchema).readonly().default([]),
    files: z.array(archiveFileSchema).readonly().default([]),
    accessCandidates: z
      .array(accessCandidateSchema)
      .readonly()
      .default([]),
  })
  .strict()

export type BuildertrendStagingManifest = z.infer<
  typeof buildertrendStagingManifestSchema
>

export type BuildertrendStagingSummary = {
  readonly runKey: string
  readonly sourceLabel: string
  readonly recordCount: number
  readonly fileCount: number
  readonly accessCandidateCount: number
}

export type BuildertrendStagingBuild = {
  readonly sql: string
  readonly statements: readonly string[]
  readonly summary: BuildertrendStagingSummary
}

export type BuildertrendStagingParseResult =
  | {
      readonly success: true
      readonly data: BuildertrendStagingManifest
    }
  | {
      readonly success: false
      readonly errors: readonly string[]
    }

type ChildReference = {
  readonly projectId?: string
  readonly sourceRecordKey?: string
}

function sqlText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "NULL"
  return `'${value.replaceAll("'", "''")}'`
}

function sqlNumber(value: number | undefined): string {
  return value === undefined ? "NULL" : String(value)
}

function jsonText(value: unknown): string {
  if (value === undefined) return "NULL"
  const encoded = JSON.stringify(value)
  return encoded === undefined ? "NULL" : sqlText(encoded)
}

async function manifestFingerprint(
  manifest: BuildertrendStagingManifest
): Promise<string> {
  const canonicalManifest = {
    ...manifest,
    records: [...manifest.records].sort((left, right) =>
      stableTextCompare(left.sourceKey, right.sourceKey)
    ),
    files: [...manifest.files].sort((left, right) =>
      stableTextCompare(left.sourceKey, right.sourceKey)
    ),
    accessCandidates: [...manifest.accessCandidates].sort((left, right) =>
      stableTextCompare(left.sourceKey, right.sourceKey)
    ),
  }
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonicalJsonValue(canonicalManifest))
  )
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (value === null || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => stableTextCompare(left, right))
      .map(([key, nestedValue]) => [key, canonicalJsonValue(nestedValue)])
  )
}

function stableTextCompare(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function stableId(
  kind: "run" | "source" | "file" | "access" | "observation",
  organizationId: string,
  key: string
): string {
  return `buildertrend:${kind}:${organizationId}:${key}`
}

function scopedProjectId(
  organizationId: string,
  projectId: string | undefined
): string {
  if (!projectId) return "NULL"
  return `(SELECT id FROM projects WHERE id = ${sqlText(projectId)} AND organization_id = ${sqlText(organizationId)} LIMIT 1)`
}

function scopedSourceRecordId(
  organizationId: string,
  reference: ChildReference
): string {
  if (!reference.sourceRecordKey) return "NULL"

  const projectCompatibility = reference.projectId
    ? ` AND (project_id IS NULL OR project_id = ${scopedProjectId(
        organizationId,
        reference.projectId
      )})`
    : ""

  return `(SELECT id FROM buildertrend_staging_records WHERE organization_id = ${sqlText(organizationId)} AND source_key = ${sqlText(reference.sourceRecordKey)}${projectCompatibility} LIMIT 1)`
}

function activeRunGuardSql(
  organizationId: string,
  manifest: BuildertrendStagingManifest,
  fingerprint: string
): string {
  const runId = stableId("run", organizationId, manifest.runKey)
  return `EXISTS (
    SELECT 1 FROM buildertrend_staging_runs
    WHERE id = ${sqlText(runId)}
      AND organization_id = ${sqlText(organizationId)}
      AND manifest_fingerprint = ${sqlText(fingerprint)}
      AND status = 'in_progress'
  )`
}

function initialReviewStatusSql(
  organizationId: string,
  reference: ChildReference
): string {
  const invalidChecks: string[] = []
  if (reference.projectId) {
    invalidChecks.push(
      `NOT EXISTS (SELECT 1 FROM projects WHERE id = ${sqlText(
        reference.projectId
      )} AND organization_id = ${sqlText(organizationId)})`
    )
  }
  if (reference.sourceRecordKey) {
    invalidChecks.push(
      `${scopedSourceRecordId(organizationId, reference)} IS NULL`
    )
  }

  if (invalidChecks.length === 0) return "'needs_review'"
  return `CASE WHEN ${invalidChecks.join(
    " OR "
  )} THEN 'unresolved_reference' ELSE 'needs_review' END`
}

function ensureUniqueKeys(
  label: string,
  values: readonly { readonly sourceKey: string }[]
): readonly string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const value of values) {
    if (seen.has(value.sourceKey)) duplicates.add(value.sourceKey)
    seen.add(value.sourceKey)
  }

  return [...duplicates].map(
    (sourceKey) => `${label} contains duplicate sourceKey "${sourceKey}"`
  )
}

function validateManifestLinks(
  manifest: BuildertrendStagingManifest
): readonly string[] {
  const recordProjects = new Map(
    manifest.records.map((record) => [record.sourceKey, record.projectId])
  )
  const errors: string[] = []

  function validateChildren(
    label: string,
    children: readonly {
      readonly sourceKey: string
      readonly sourceRecordKey?: string
      readonly projectId?: string
    }[]
  ): void {
    for (const child of children) {
      if (!child.sourceRecordKey) continue
      const parentProjectId = recordProjects.get(child.sourceRecordKey)
      if (!recordProjects.has(child.sourceRecordKey)) continue
      if (
        parentProjectId &&
        child.projectId &&
        parentProjectId !== child.projectId
      ) {
        errors.push(
          `${label}.${child.sourceKey} projectId does not match source record "${child.sourceRecordKey}"`
        )
      }
    }
  }

  validateChildren("files", manifest.files)
  validateChildren("accessCandidates", manifest.accessCandidates)

  return errors
}

export function parseBuildertrendStagingManifest(
  value: unknown
): BuildertrendStagingParseResult {
  const result = buildertrendStagingManifestSchema.safeParse(value)
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map(
        (issue) =>
          `${issue.path.length > 0 ? issue.path.join(".") : "manifest"}: ${issue.message}`
      ),
    }
  }

  const errors = [
    ...ensureUniqueKeys("records", result.data.records),
    ...ensureUniqueKeys("files", result.data.files),
    ...ensureUniqueKeys("accessCandidates", result.data.accessCandidates),
    ...validateManifestLinks(result.data),
  ]

  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: result.data }
}

function importRunStartSql(
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
  source_method = CASE
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
}

function sourceRecordSql(
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
  requested_project_id = CASE
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
}

function archiveFileSql(
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
  requested_source_record_key = CASE
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
}

function accessCandidateSql(
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
  requested_source_record_key = CASE
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
}

function observationSql(
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

function parentChildInvariantSql(
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

function importRunFinalizeSql(
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

export async function buildBuildertrendStagingSql(
  organizationId: string,
  manifest: BuildertrendStagingManifest
): Promise<BuildertrendStagingBuild> {
  const normalizedOrganizationId = organizationId.trim()
  if (!normalizedOrganizationId) {
    throw new Error("organizationId is required")
  }

  const summary: BuildertrendStagingSummary = {
    runKey: manifest.runKey,
    sourceLabel: manifest.sourceLabel,
    recordCount: manifest.records.length,
    fileCount: manifest.files.length,
    accessCandidateCount: manifest.accessCandidates.length,
  }
  const fingerprint = await manifestFingerprint(manifest)

  const statements = [
    importRunStartSql(normalizedOrganizationId, manifest, fingerprint),
    ...manifest.records.flatMap((record) => {
      const entityId = stableId(
        "source",
        normalizedOrganizationId,
        record.sourceKey
      )
      return [
        sourceRecordSql(
          normalizedOrganizationId,
          manifest,
          fingerprint,
          record
        ),
        observationSql(
          normalizedOrganizationId,
          manifest,
          fingerprint,
          "record",
          record.sourceKey,
          entityId,
          record
        ),
      ]
    }),
    ...manifest.files.flatMap((file) => {
      const entityId = stableId(
        "file",
        normalizedOrganizationId,
        file.sourceKey
      )
      return [
        archiveFileSql(
          normalizedOrganizationId,
          manifest,
          fingerprint,
          file
        ),
        observationSql(
          normalizedOrganizationId,
          manifest,
          fingerprint,
          "file",
          file.sourceKey,
          entityId,
          file
        ),
      ]
    }),
    ...manifest.accessCandidates.flatMap((candidate) => {
      const entityId = stableId(
        "access",
        normalizedOrganizationId,
        candidate.sourceKey
      )
      return [
        accessCandidateSql(
          normalizedOrganizationId,
          manifest,
          fingerprint,
          candidate
        ),
        observationSql(
          normalizedOrganizationId,
          manifest,
          fingerprint,
          "access_candidate",
          candidate.sourceKey,
          entityId,
          candidate
        ),
      ]
    }),
    ...parentChildInvariantSql(
      normalizedOrganizationId,
      manifest,
      fingerprint
    ),
    importRunFinalizeSql(normalizedOrganizationId, manifest, fingerprint),
  ]

  const sql = [
    "-- Buildertrend staging import generated by Compass.",
    "-- Execute statements as one D1 batch when applying outside Wrangler.",
    "-- A partial execution remains in_progress and is safe to replay.",
    "-- Archive/review only: no access grants, notifications, operational finance, or Sage writes.",
    `-- Input summary: ${JSON.stringify(summary)}`,
    ...statements,
    "",
  ].join("\n")

  return { sql, statements, summary }
}
