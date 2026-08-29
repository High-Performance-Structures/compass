import { createHash } from "node:crypto"

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`)
  }
  return value.trim()
}

function optionalString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function sql(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite SQL number")
    return String(value)
  }
  if (typeof value === "boolean") return value ? "1" : "0"
  return `'${String(value).replaceAll("'", "''")}'`
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function fingerprint(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function isoDate(value, label) {
  const date = requiredString(value, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${label} must be YYYY-MM-DD`)
  }
  const parsed = new Date(`${date}T12:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} is invalid`)
  }
  return date
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return value
}

function weatherObject(record) {
  const value = record.weather ?? record.rawWeather ?? {}
  if (Array.isArray(value)) return { observations: value }
  if (value === null || typeof value !== "object") {
    throw new Error(`weather for ${record.sourceId} must be an object or array`)
  }
  return value
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object[key]
    if (value !== null && value !== undefined && value !== "") return value
  }
  return null
}

function numberValue(value, label) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be numeric`)
  return Math.round(parsed)
}

function textValue(value) {
  if (value === null || value === undefined || value === "") return null
  if (Array.isArray(value)) return value.map(String).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function isMatchingGoogleDriveFileUrl(candidate, driveFileId) {
  try {
    const url = new URL(candidate)
    const pathMatch = url.pathname.match(/^\/file\/d\/([^/]+)(?:\/|$)/)
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "drive.google.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      pathMatch?.[1] === driveFileId
    )
  } catch {
    return false
  }
}

function normalizeAttachment(
  attachment,
  recordSourceId,
  index,
  projectDriveFolderId,
  approvedAttachmentFolderIds,
) {
  if (attachment === null || typeof attachment !== "object" || Array.isArray(attachment)) {
    throw new Error(`attachment ${index + 1} for ${recordSourceId} must be an object`)
  }
  const driveFileId = requiredString(
    attachment.driveFileId ?? attachment.id,
    `Drive file ID for ${recordSourceId} attachment ${index + 1}`,
  )
  const driveUrl = requiredString(
    attachment.driveUrl ?? attachment.url,
    `Drive URL for ${recordSourceId} attachment ${index + 1}`,
  )
  if (!isMatchingGoogleDriveFileUrl(driveUrl, driveFileId)) {
    throw new Error(
      `Drive URL for ${recordSourceId} attachment ${index + 1} must reference the matching Google Drive file`,
    )
  }
  const driveFolderId = requiredString(
    attachment.driveFolderId ?? attachment.folderId ?? projectDriveFolderId,
    `Drive folder ID for ${recordSourceId} attachment ${index + 1}`,
  )
  if (!approvedAttachmentFolderIds.has(driveFolderId)) {
    throw new Error(`Drive attachment ${driveFileId} is not under the project folder allowlist`)
  }
  const fileName = requiredString(
    attachment.fileName ?? attachment.name,
    `Drive file name for ${recordSourceId} attachment ${index + 1}`,
  )
  const fileSize = attachment.fileSize === null || attachment.fileSize === undefined
    ? null
    : nonNegativeInteger(attachment.fileSize, `fileSize for ${recordSourceId} attachment ${index + 1}`)
  return {
    driveFileId,
    driveUrl,
    driveFolderId,
    fileName,
    fileSize,
    mimeType: optionalString(attachment.mimeType),
    caption: optionalString(attachment.caption ?? attachment.title),
    capturedAt: optionalString(attachment.capturedAt),
    thumbnailUrl: optionalString(attachment.thumbnailUrl),
    buildertrendFileId: optionalString(attachment.buildertrendFileId ?? attachment.sourceFileId),
    photoKind: optionalString(attachment.photoKind) ?? "document_reference",
  }
}

function normalizeRecord(record, projectDriveFolderId, approvedAttachmentFolderIds) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Each daily-log delta record must be an object")
  }
  const sourceId = requiredString(record.sourceId ?? record.buildertrendRecordId, "sourceId")
  if (!/^\d+$/.test(sourceId)) throw new Error(`Invalid sourceId: ${sourceId}`)
  const title = requiredString(record.title, `title for ${sourceId}`)
  const author = requiredString(record.author ?? record.sourceAuthor, `source author for ${sourceId}`)
  const logDate = isoDate(record.logDate ?? record.date, `logDate for ${sourceId}`)
  const weather = weatherObject(record)
  const highTemperature = numberValue(
    firstValue(weather, ["highF", "temperatureHighF", "tempHighF", "high", "temperatureHigh"]),
    `weather high for ${sourceId}`,
  )
  const lowTemperature = numberValue(
    firstValue(weather, ["lowF", "temperatureLowF", "tempLowF", "low", "temperatureLow"]),
    `weather low for ${sourceId}`,
  )
  const conditions = textValue(firstValue(weather, ["conditions", "condition", "summary"]))
  const precipitation = textValue(firstValue(weather, [
    "precipitation",
    "precipitationIn",
    "precipitationAmount",
    "rain",
    "rainIn",
    "snow",
    "snowIn",
  ]))
  const wind = textValue(firstValue(weather, ["wind", "windSummary", "windSpeed", "windMph"]))
  const humidity = textValue(firstValue(weather, ["humidity", "humidityPercent"]))
  const visibility = Array.isArray(record.visibility)
    ? record.visibility.map((entry) => requiredString(entry, `visibility for ${sourceId}`))
    : []
  const tags = Array.isArray(record.tags)
    ? record.tags.map((entry) => requiredString(entry, `tag for ${sourceId}`))
    : []
  const attachmentsInput = record.attachments ?? record.driveAttachments ?? []
  if (!Array.isArray(attachmentsInput)) throw new Error(`attachments for ${sourceId} must be an array`)
  const attachments = attachmentsInput.map((attachment, index) =>
    normalizeAttachment(
      attachment,
      sourceId,
      index,
      projectDriveFolderId,
      approvedAttachmentFolderIds,
    ),
  )
  const workCompleted = optionalString(record.workCompleted ?? record.notes)
    ?? `Buildertrend daily log for ${logDate}`
  const rawPayload = JSON.parse(JSON.stringify(record))
  const sourceUrl = optionalString(record.sourceUrl ?? record.buildertrendUrl)
  const sourceStatus = optionalString(record.status ?? record.recordStatus)
  return {
    sourceId,
    title,
    author,
    logDate,
    visibility,
    tags,
    weather,
    normalizedWeather: {
      highTemperature,
      lowTemperature,
      conditions,
      precipitation,
      wind,
      humidity,
    },
    workCompleted,
    issues: optionalString(record.issues),
    notes: optionalString(record.notes),
    sourceUrl,
    sourceStatus,
    rawPayload,
    attachments,
  }
}

function validateFixture(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Fixture must be an object")
  }
  const organizationId = requiredString(input.organizationId, "organizationId")
  const projectId = requiredString(input.projectId, "projectId")
  const projectNumber = requiredString(input.projectNumber, "projectNumber")
  const buildertrendJobId = requiredString(input.buildertrendJobId, "buildertrendJobId")
  const projectDriveFolderId = requiredString(input.projectDriveFolderId, "projectDriveFolderId")
  const approvedFolderInput = input.approvedAttachmentFolderIds ?? []
  if (!Array.isArray(approvedFolderInput)) {
    throw new Error("approvedAttachmentFolderIds must be an array")
  }
  const approvedAttachmentFolderIds = new Set([projectDriveFolderId])
  for (const folderId of approvedFolderInput) {
    approvedAttachmentFolderIds.add(requiredString(folderId, "approved attachment folder ID"))
  }
  const capturedAt = requiredString(input.capturedAt, "capturedAt")
  const sourceLabel = requiredString(input.sourceLabel, "sourceLabel")
  if (Number.isNaN(new Date(capturedAt).getTime())) throw new Error("capturedAt is invalid")
  if (!Array.isArray(input.records) || input.records.length === 0) {
    throw new Error("records must be a non-empty array")
  }
  const records = input.records.map((record) =>
    normalizeRecord(record, projectDriveFolderId, approvedAttachmentFolderIds),
  )
  const sourceIds = new Set()
  const driveFileIds = new Set()
  for (const record of records) {
    if (sourceIds.has(record.sourceId)) throw new Error(`Duplicate sourceId: ${record.sourceId}`)
    sourceIds.add(record.sourceId)
    for (const attachment of record.attachments) {
      if (driveFileIds.has(attachment.driveFileId)) {
        throw new Error(`Duplicate Drive attachment: ${attachment.driveFileId}`)
      }
      driveFileIds.add(attachment.driveFileId)
    }
  }
  return {
    organizationId,
    projectId,
    projectNumber,
    buildertrendJobId,
    projectDriveFolderId,
    approvedAttachmentFolderIds: [...approvedAttachmentFolderIds],
    capturedAt,
    sourceLabel,
    rawArtifactDriveFileId: optionalString(input.rawArtifactDriveFileId),
    rawArtifactDriveUrl: optionalString(input.rawArtifactDriveUrl),
    evidenceDriveFileId: optionalString(input.evidenceDriveFileId),
    evidenceDriveUrl: optionalString(input.evidenceDriveUrl),
    records,
  }
}

function recordKey(fixture, sourceId) {
  return `legacy-record:bt-delta-daily-log-${fixture.buildertrendJobId}-${sourceId}`
}

function dailyLogId(fixture, sourceId) {
  return `bt-delta-dl-${fixture.buildertrendJobId}-${sourceId}`
}

function photoId(fixture, sourceId, driveFileId) {
  return `bt-delta-photo-${fixture.buildertrendJobId}-${sourceId}-${fingerprint(driveFileId).slice(0, 16)}`
}

function payloadFor(fixture, record) {
  return {
    schemaVersion: 1,
    captureKind: "daily_log_delta",
    completeRegister: false,
    organizationId: fixture.organizationId,
    projectId: fixture.projectId,
    projectNumber: fixture.projectNumber,
    buildertrendJobId: fixture.buildertrendJobId,
    capturedAt: fixture.capturedAt,
    sourceLabel: fixture.sourceLabel,
    projectDriveFolderId: fixture.projectDriveFolderId,
    approvedAttachmentFolderIds: fixture.approvedAttachmentFolderIds,
    sourceRecordId: record.sourceId,
    logDate: record.logDate,
    author: record.author,
    weather: record.weather,
    attachments: record.attachments,
    rawCapture: record.rawPayload,
  }
}

function weatherConditions(record) {
  const values = [
    record.normalizedWeather.conditions,
    record.normalizedWeather.wind === null ? null : `wind ${record.normalizedWeather.wind}`,
    record.normalizedWeather.humidity === null ? null : `humidity ${record.normalizedWeather.humidity}`,
  ].filter((value) => value !== null)
  return values.length === 0 ? null : values.join("; ")
}

export function generateBuildertrendDailyLogDeltaImportSql(input) {
  const fixture = validateFixture(input)
  const manifestFingerprint = fingerprint({
    ...fixture,
    records: fixture.records.map((record) => payloadFor(fixture, record)),
  })
  const captureDate = fixture.capturedAt.slice(0, 10).replaceAll("-", "")
  const shortFingerprint = manifestFingerprint.slice(0, 12)
  const runId = `bt-daily-log-delta-${fixture.buildertrendJobId}-${captureDate}-${shortFingerprint}`
  const runKey = `daily-log-delta:${fixture.buildertrendJobId}:${captureDate}:${shortFingerprint}`
  const guardChecks = [
    `(SELECT COUNT(*) FROM projects WHERE id=${sql(fixture.projectId)} AND organization_id=${sql(fixture.organizationId)} AND project_number=${sql(fixture.projectNumber)} AND buildertrend_project_id=${sql(fixture.buildertrendJobId)} AND google_drive_folder_id=${sql(fixture.projectDriveFolderId)})=1`,
    ...fixture.records.map((record) => {
      const key = recordKey(fixture, record.sourceId)
      return `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE organization_id=${sql(fixture.organizationId)} AND source_key=${sql(key)} AND (project_id<>${sql(fixture.projectId)} OR buildertrend_job_id<>${sql(fixture.buildertrendJobId)} OR source_record_type<>'daily_log'))=0`
    }),
    ...fixture.records.map((record) =>
      `(SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(fixture.projectId)} AND source_system='buildertrend' AND source_external_id=${sql(record.sourceId)})<=1`,
    ),
    ...fixture.records.flatMap((record) => record.attachments.map((attachment) =>
      `(SELECT COUNT(*) FROM daily_log_photos WHERE project_id<>${sql(fixture.projectId)} AND source_system='google_drive_reference' AND source_external_id=${sql(attachment.driveFileId)})=0`,
    )),
  ]
  const guardStatements = []
  for (let index = 0; index < guardChecks.length; index += 35) {
    guardStatements.push(
      `INSERT INTO projects (id, name, status, organization_id, created_at, updated_at) SELECT NULL, 'Buildertrend daily-log delta guard', 'OPEN', ${sql(fixture.organizationId)}, ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)} WHERE NOT (${guardChecks.slice(index, index + 35).join(" AND ")});`,
    )
  }
  const summary = JSON.stringify({
    captureKind: "daily_log_delta",
    completeRegister: false,
    projectId: fixture.projectId,
    projectNumber: fixture.projectNumber,
    buildertrendJobId: fixture.buildertrendJobId,
    sourceRecordCount: fixture.records.length,
    attachmentCount: fixture.records.reduce((total, record) => total + record.attachments.length, 0),
  })
  const statements = [
    ...guardStatements,
    `INSERT INTO buildertrend_staging_runs (id, organization_id, run_key, manifest_fingerprint, source_method, source_label, status, started_by, started_at, completed_at, raw_artifact_drive_file_id, raw_artifact_drive_url, source_notes, summary_json, created_at, updated_at) VALUES (${sql(runId)}, ${sql(fixture.organizationId)}, ${sql(runKey)}, ${sql(manifestFingerprint)}, 'authenticated_browser_capture', ${sql(fixture.sourceLabel)}, 'completed', NULL, ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}, ${sql(fixture.rawArtifactDriveFileId)}, ${sql(fixture.rawArtifactDriveUrl)}, 'Delta capture only; this run is not a complete Buildertrend daily-log register.', ${sql(summary)}, ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}) ON CONFLICT(organization_id, run_key) DO UPDATE SET status='completed', completed_at=excluded.completed_at, summary_json=excluded.summary_json, raw_artifact_drive_file_id=excluded.raw_artifact_drive_file_id, raw_artifact_drive_url=excluded.raw_artifact_drive_url, updated_at=excluded.updated_at WHERE buildertrend_staging_runs.manifest_fingerprint=excluded.manifest_fingerprint;`,
  ]

  for (const record of fixture.records) {
    const payload = payloadFor(fixture, record)
    const payloadJson = JSON.stringify(payload)
    const tags = JSON.stringify({
      buildertrendProjectId: fixture.buildertrendJobId,
      buildertrendAuthor: record.author,
      buildertrendTitle: record.title,
      buildertrendVisibility: record.visibility,
      buildertrendTags: record.tags,
      buildertrendWeather: record.weather,
      buildertrendWeatherNormalized: record.normalizedWeather,
      buildertrendDriveAttachments: record.attachments,
      buildertrendAttachmentCount: record.attachments.length,
      migrationDisposition: "daily_log_delta",
    })
    const id = dailyLogId(fixture, record.sourceId)
    statements.push(
      `INSERT INTO daily_logs (id, project_id, author_id, source_system, source_external_id, log_date, weather_temp_f, weather_conditions, weather_precipitation, weather_source, work_completed, issues, materials_used, crew_present, hours_worked, safety_incidents, visitor_log, notes, is_client_visible, review_status, tags, sync_status, created_at, updated_at) SELECT ${sql(id)}, ${sql(fixture.projectId)}, NULL, 'buildertrend', ${sql(record.sourceId)}, ${sql(record.logDate)}, ${sql(record.normalizedWeather.highTemperature)}, ${sql(weatherConditions(record))}, ${sql(record.normalizedWeather.precipitation)}, 'buildertrend', ${sql(record.workCompleted)}, ${sql(record.issues)}, NULL, NULL, NULL, NULL, NULL, ${sql(record.notes)}, 0, 'needs_review', ${sql(tags)}, 'synced', ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)} WHERE NOT EXISTS (SELECT 1 FROM daily_logs WHERE project_id=${sql(fixture.projectId)} AND source_system='buildertrend' AND source_external_id=${sql(record.sourceId)});`,
    )
    const key = recordKey(fixture, record.sourceId)
    const stagingId = `bt-delta-source-${fixture.buildertrendJobId}-${record.sourceId}`
    statements.push(
      `INSERT INTO buildertrend_staging_records (id, organization_id, source_key, requested_project_id, project_id, source_scope, source_record_type, buildertrend_job_id, buildertrend_lead_id, buildertrend_record_id, buildertrend_record_number, buildertrend_url, title, record_date, record_status, source_status, department_code, client_name, contact_name, contact_email, amount, searchable_text, normalized_summary, raw_payload_json, source_archive_drive_folder_id, source_archive_drive_file_id, source_archive_drive_url, verified_archive_drive_folder_id, verified_archive_drive_file_id, verified_archive_drive_url, review_status, promotion_status, promoted_record_type, promoted_record_id, sage_reconciliation_status, source_notes, review_notes, created_at, updated_at) VALUES (${sql(stagingId)}, ${sql(fixture.organizationId)}, ${sql(key)}, ${sql(fixture.projectId)}, ${sql(fixture.projectId)}, 'job', 'daily_log', ${sql(fixture.buildertrendJobId)}, NULL, ${sql(record.sourceId)}, NULL, ${sql(record.sourceUrl)}, ${sql(record.title)}, ${sql(record.logDate)}, ${sql(record.sourceStatus ?? 'captured')}, ${sql(record.visibility.join(', '))}, ${sql(fixture.projectNumber.split('-')[0])}, NULL, ${sql(record.author)}, NULL, NULL, ${sql(`${record.title} ${record.author} ${record.tags.join(' ')} ${record.workCompleted}`)}, ${sql(`${record.title}; ${record.author}; daily-log delta`)}, ${sql(payloadJson)}, ${sql(fixture.projectDriveFolderId)}, NULL, NULL, ${sql(fixture.projectDriveFolderId)}, NULL, NULL, 'verified', 'promoted', 'daily_log', COALESCE((SELECT id FROM daily_logs WHERE project_id=${sql(fixture.projectId)} AND source_system='buildertrend' AND source_external_id=${sql(record.sourceId)} ORDER BY id LIMIT 1), ${sql(id)}), 'not_reviewed', 'Authenticated Buildertrend daily-log delta capture.', 'Delta-only capture; complete raw weather is retained in raw_payload_json and tags. Operational record remains internal for review.', ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}) ON CONFLICT(organization_id, source_key) DO UPDATE SET project_id=excluded.project_id, buildertrend_url=excluded.buildertrend_url, title=excluded.title, record_date=excluded.record_date, record_status=excluded.record_status, source_status=excluded.source_status, contact_name=excluded.contact_name, searchable_text=excluded.searchable_text, normalized_summary=excluded.normalized_summary, raw_payload_json=excluded.raw_payload_json, source_archive_drive_folder_id=excluded.source_archive_drive_folder_id, verified_archive_drive_folder_id=excluded.verified_archive_drive_folder_id, review_status='verified', promotion_status='promoted', promoted_record_type='daily_log', promoted_record_id=COALESCE((SELECT id FROM daily_logs WHERE project_id=${sql(fixture.projectId)} AND source_system='buildertrend' AND source_external_id=${sql(record.sourceId)} ORDER BY id LIMIT 1), excluded.promoted_record_id), source_notes=excluded.source_notes, review_notes=excluded.review_notes, updated_at=excluded.updated_at WHERE buildertrend_staging_records.organization_id=excluded.organization_id AND buildertrend_staging_records.project_id=excluded.project_id AND buildertrend_staging_records.buildertrend_job_id=excluded.buildertrend_job_id AND buildertrend_staging_records.source_record_type='daily_log';`,
      `INSERT OR IGNORE INTO buildertrend_staging_observations (id, import_run_id, organization_id, entity_kind, entity_key, entity_id, observed_payload_json, observed_at) VALUES (${sql(`bt-delta-observation-${fixture.buildertrendJobId}-${record.sourceId}-${shortFingerprint}`)}, ${sql(runId)}, ${sql(fixture.organizationId)}, 'record', ${sql(key)}, ${sql(stagingId)}, ${sql(payloadJson)}, ${sql(fixture.capturedAt)});`,
    )
    for (const [index, attachment] of record.attachments.entries()) {
      const attachmentId = photoId(fixture, record.sourceId, attachment.driveFileId)
      statements.push(
        `INSERT INTO daily_log_photos (id, project_id, daily_log_id, uploaded_by, source_system, source_external_id, file_name, file_size, mime_type, drive_file_id, drive_url, thumbnail_url, caption, captured_at, gps_lat, gps_lng, upload_status, review_status, owner_visible, sub_vendor_visible, public_shareable, photo_kind, schedule_phase_override, sort_order, created_at, updated_at) VALUES (${sql(attachmentId)}, ${sql(fixture.projectId)}, COALESCE((SELECT id FROM daily_logs WHERE project_id=${sql(fixture.projectId)} AND source_system='buildertrend' AND source_external_id=${sql(record.sourceId)} ORDER BY id LIMIT 1), ${sql(id)}), NULL, 'google_drive_reference', ${sql(attachment.driveFileId)}, ${sql(attachment.fileName)}, ${sql(attachment.fileSize)}, ${sql(attachment.mimeType)}, ${sql(attachment.driveFileId)}, ${sql(attachment.driveUrl)}, ${sql(attachment.thumbnailUrl)}, ${sql(attachment.caption ?? record.title)}, ${sql(attachment.capturedAt ?? record.logDate)}, NULL, NULL, 'linked', 'needs_review', 0, 0, 0, ${sql(attachment.photoKind)}, NULL, ${index}, ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}) ON CONFLICT(id) DO UPDATE SET daily_log_id=excluded.daily_log_id, file_name=excluded.file_name, file_size=excluded.file_size, mime_type=excluded.mime_type, drive_file_id=excluded.drive_file_id, drive_url=excluded.drive_url, thumbnail_url=excluded.thumbnail_url, caption=excluded.caption, captured_at=excluded.captured_at, upload_status='linked', updated_at=excluded.updated_at WHERE daily_log_photos.project_id=excluded.project_id;`,
      )
    }
  }

  const attestationId = `bt-attestation-${fixture.projectId}-daily-log-delta`
  statements.push(
    `INSERT INTO buildertrend_module_attestations (id, organization_id, project_id, import_run_id, module_key, status, observed_count, manifest_fingerprint, evidence_drive_file_id, evidence_drive_url, source_label, checked_at, verified_by, notes, created_at, updated_at) VALUES (${sql(attestationId)}, ${sql(fixture.organizationId)}, ${sql(fixture.projectId)}, ${sql(runId)}, 'daily_logs', 'partial', ${fixture.records.length}, ${sql(manifestFingerprint)}, ${sql(fixture.evidenceDriveFileId)}, ${sql(fixture.evidenceDriveUrl)}, ${sql(fixture.sourceLabel)}, ${sql(fixture.capturedAt)}, NULL, 'Delta capture only; observed_count is this delta and does not attest to a complete Buildertrend daily-log register.', ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}) ON CONFLICT(organization_id, project_id, module_key) DO UPDATE SET import_run_id=excluded.import_run_id, status='partial', observed_count=excluded.observed_count, manifest_fingerprint=excluded.manifest_fingerprint, evidence_drive_file_id=excluded.evidence_drive_file_id, evidence_drive_url=excluded.evidence_drive_url, source_label=excluded.source_label, checked_at=excluded.checked_at, notes=excluded.notes, updated_at=excluded.updated_at WHERE buildertrend_module_attestations.status<>'captured';`,
    `SELECT ${sql(fixture.projectId)} AS project_id, 'daily_log_delta' AS capture_kind, 0 AS complete_register_attested, ${fixture.records.length} AS expected_delta_records, (SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(fixture.projectId)} AND buildertrend_job_id=${sql(fixture.buildertrendJobId)} AND source_record_type='daily_log' AND source_key LIKE 'legacy-record:bt-delta-daily-log-%') AS staged_delta_records, (SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(fixture.projectId)} AND source_system='buildertrend' AND source_external_id IN (${fixture.records.map((record) => sql(record.sourceId)).join(', ')})) AS operational_delta_records, (SELECT COUNT(*) FROM daily_log_photos WHERE project_id=${sql(fixture.projectId)} AND source_system='google_drive_reference' AND source_external_id IN (${fixture.records.flatMap((record) => record.attachments).map((attachment) => sql(attachment.driveFileId)).join(', ') || "NULL"})) AS linked_drive_attachments;`,
  )
  // Wrangler's remote D1 importer applies a SQL file atomically and rejects
  // explicit transaction statements. Keep the fail-closed guards in-file.
  return [...statements, ""].join("\n")
}

export function summarizeBuildertrendDailyLogDeltaImport(input) {
  const fixture = validateFixture(input)
  return {
    captureKind: "daily_log_delta",
    completeRegister: false,
    projectId: fixture.projectId,
    projectNumber: fixture.projectNumber,
    buildertrendJobId: fixture.buildertrendJobId,
    sourceRecordCount: fixture.records.length,
    attachmentCount: fixture.records.reduce((total, record) => total + record.attachments.length, 0),
    sourceAuthorsPresent: fixture.records.every((record) => record.author.length > 0),
    rawWeatherPreserved: true,
    approvedAttachmentFolderIds: fixture.approvedAttachmentFolderIds,
    normalizedWeatherCount: fixture.records.filter((record) =>
      Object.values(record.normalizedWeather).some((value) => value !== null),
    ).length,
    moduleAttestationStatus: "partial",
    createsExternalLinks: false,
  }
}
