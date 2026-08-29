import { createHash } from "node:crypto"

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`)
  }
  return value.trim()
}

function sql(value) {
  if (value === null) return "NULL"
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Unsafe integer in import")
    return String(value)
  }
  return `'${String(value).replaceAll("'", "''")}'`
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function fingerprint(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be a string array`)
  }
  return value.map((entry) => entry.trim()).filter(Boolean)
}

function logDateFromTitle(title, capturedAt) {
  const dateLabel = title.split("|")[0].trim().replace(/^[A-Za-z]{3},\s*/, "")
  const match = dateLabel.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?$/)
  if (!match) throw new Error(`Cannot parse daily-log date from: ${title}`)
  const monthNames = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ]
  const month = monthNames.indexOf(match[1].slice(0, 3).toLowerCase()) + 1
  if (month === 0) throw new Error(`Cannot parse daily-log month from: ${title}`)
  const year = Number(match[3] ?? capturedAt.slice(0, 4))
  const day = Number(match[2])
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid daily-log date in: ${title}`)
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function titleDetail(title) {
  const separator = title.indexOf("|")
  return separator === -1 ? "" : title.slice(separator + 1).trim()
}

function normalizedMediaCount(record) {
  const documentThumbnailOnly =
    record.documentNames.length > 0 &&
    record.displayedMedia.length > 0 &&
    record.displayedMedia.every((entry) => !entry.fileName)
  return documentThumbnailOnly ? record.documentNames.length : record.mediaCount
}

function normalizedRecord(record, capturedAt) {
  const sourceId = requiredString(record.sourceId, "sourceId")
  if (!/^\d+$/.test(sourceId)) throw new Error(`Invalid sourceId: ${sourceId}`)
  const title = requiredString(record.title, `title for ${sourceId}`)
  const authorValue = record.author
  if (
    typeof authorValue !== "string" ||
    authorValue.trim().length === 0
  ) {
    throw new Error(
      `Buildertrend human-authored daily log ${sourceId} is missing its source author`
    )
  }
  const author = requiredString(authorValue, `author for ${sourceId}`)
  const visibility = stringArray(record.visibility, `visibility for ${sourceId}`)
  const tags = stringArray(record.tags, `tags for ${sourceId}`)
  const weather = stringArray(record.weather, `weather for ${sourceId}`)
  const documentNames = stringArray(record.documentNames, `documentNames for ${sourceId}`)
  if (!Array.isArray(record.displayedMedia)) {
    throw new Error(`displayedMedia for ${sourceId} must be an array`)
  }
  const displayedMedia = record.displayedMedia.map((entry) => ({
    fileName: typeof entry.fileName === "string" && entry.fileName.trim() ? entry.fileName.trim() : null,
    buildertrendFileId:
      typeof entry.previewUrl === "string"
        ? entry.previewUrl.match(/\/api\/files\/(\d+)\//)?.[1] ?? null
        : null,
  }))
  if (!Number.isSafeInteger(record.mediaCount) || record.mediaCount < 0) {
    throw new Error(`Invalid mediaCount for ${sourceId}`)
  }
  const notes = typeof record.notes === "string" && record.notes.trim() ? record.notes.trim() : null
  const logDate = logDateFromTitle(title, capturedAt)
  const detail = titleDetail(title)
  const workCompleted = notes ?? (detail || `Buildertrend daily log for ${logDate}`)
  const highTemperature = weather[0]?.match(/-?\d+/)?.[0]
  const weatherTempF = highTemperature === undefined ? null : Number(highTemperature)
  if (weatherTempF !== null && !Number.isSafeInteger(weatherTempF)) {
    throw new Error(`Invalid weather temperature for ${sourceId}`)
  }
  return {
    sourceId,
    title,
    author,
    visibility,
    tags,
    weather,
    weatherTempF,
    documentNames,
    displayedMedia,
    mediaCount: normalizedMediaCount({
      documentNames,
      displayedMedia,
      mediaCount: record.mediaCount,
    }),
    logDate,
    workCompleted,
    isClientVisible: visibility.includes("Client"),
  }
}

function validateFixture(input) {
  const organizationId = requiredString(input.organizationId, "organizationId")
  const projectId = requiredString(input.projectId, "projectId")
  const projectNumber = requiredString(input.projectNumber, "projectNumber")
  const buildertrendJobId = requiredString(input.buildertrendJobId, "buildertrendJobId")
  const capturedAt = requiredString(input.capturedAt, "capturedAt")
  const sourceLabel = requiredString(input.sourceLabel, "sourceLabel")
  if (Number.isNaN(new Date(capturedAt).getTime())) throw new Error("capturedAt is invalid")
  if (!Array.isArray(input.records) || input.records.length === 0) {
    throw new Error("records must be a non-empty array")
  }
  if (!Array.isArray(input.existingMappings)) {
    throw new Error("existingMappings must be an array")
  }
  const records = input.records.map((record) => normalizedRecord(record, capturedAt))
  const sourceIds = new Set()
  for (const record of records) {
    if (sourceIds.has(record.sourceId)) throw new Error(`Duplicate sourceId: ${record.sourceId}`)
    sourceIds.add(record.sourceId)
  }
  const mappedSourceIds = new Set()
  const mappedDailyLogIds = new Set()
  const existingMappings = input.existingMappings.map((mapping) => {
    const sourceId = requiredString(mapping.sourceId, "mapping sourceId")
    const existingDailyLogId = requiredString(mapping.existingDailyLogId, "existingDailyLogId")
    const existingSourceSystem = requiredString(mapping.existingSourceSystem, "existingSourceSystem")
    const existingSourceExternalId = mapping.existingSourceExternalId === null
      ? null
      : requiredString(mapping.existingSourceExternalId, "existingSourceExternalId")
    const method = requiredString(mapping.method, "mapping method")
    if (!sourceIds.has(sourceId)) throw new Error(`Mapping references unknown sourceId: ${sourceId}`)
    if (mappedSourceIds.has(sourceId)) throw new Error(`Duplicate mapping sourceId: ${sourceId}`)
    if (mappedDailyLogIds.has(existingDailyLogId)) {
      throw new Error(`Duplicate mapped daily-log ID: ${existingDailyLogId}`)
    }
    mappedSourceIds.add(sourceId)
    mappedDailyLogIds.add(existingDailyLogId)
    return {
      sourceId,
      existingDailyLogId,
      existingSourceSystem,
      existingSourceExternalId,
      method,
    }
  })
  if (!Number.isSafeInteger(input.expectedExistingOperationalCount) || input.expectedExistingOperationalCount < 0) {
    throw new Error("expectedExistingOperationalCount must be a non-negative integer")
  }
  if (input.expectedExistingOperationalCount > existingMappings.length) {
    throw new Error("expectedExistingOperationalCount cannot exceed existingMappings length")
  }
  return {
    organizationId,
    projectId,
    projectNumber,
    buildertrendJobId,
    capturedAt,
    sourceLabel,
    records,
    existingMappings,
    expectedExistingOperationalCount: input.expectedExistingOperationalCount,
  }
}

export function generateBuildertrendDailyLogRegisterImportSql(input) {
  const fixture = validateFixture(input)
  const captureDate = fixture.capturedAt.slice(0, 10).replaceAll("-", "")
  const manifestFingerprint = fingerprint({
    projectId: fixture.projectId,
    buildertrendJobId: fixture.buildertrendJobId,
    capturedAt: fixture.capturedAt,
    records: fixture.records,
    existingMappings: fixture.existingMappings,
  })
  const shortFingerprint = manifestFingerprint.slice(0, 12)
  const runId = `bt-daily-log-register-${fixture.buildertrendJobId}-${captureDate}-${shortFingerprint}`
  const runKey = `daily-log-register:${fixture.buildertrendJobId}:${captureDate}:${shortFingerprint}`
  const mappingsBySourceId = new Map(
    fixture.existingMappings.map((mapping) => [mapping.sourceId, mapping]),
  )
  const missingRecords = fixture.records.filter((record) => !mappingsBySourceId.has(record.sourceId))
  const plannedDailyLogId = (sourceId) =>
    mappingsBySourceId.get(sourceId)?.existingDailyLogId ?? `bt-dl-${sourceId}`
  const mappingGuards = fixture.existingMappings.map((mapping) =>
    `(SELECT COUNT(*) FROM daily_logs WHERE id=${sql(mapping.existingDailyLogId)} AND project_id=${sql(fixture.projectId)} AND source_system=${sql(mapping.existingSourceSystem)} AND source_external_id IS ${sql(mapping.existingSourceExternalId)})=1`,
  )
  const missingIdsSql = missingRecords.map((record) => sql(record.sourceId)).join(", ")
  const plannedNewIdsSql = missingRecords.map((record) => sql(plannedDailyLogId(record.sourceId))).join(", ")
  const sourceIdsSql = fixture.records.map((record) => sql(record.sourceId)).join(", ")
  const stagingIdentityGuards = fixture.records.map((record) => {
    const sourceKey = `legacy-record:bt-src-daily-log-${fixture.buildertrendJobId}-${record.sourceId}`
    return `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE organization_id=${sql(fixture.organizationId)} AND source_key=${sql(sourceKey)} AND (project_id<>${sql(fixture.projectId)} OR buildertrend_job_id<>${sql(fixture.buildertrendJobId)} OR source_record_type<>'daily_log' OR (promoted_record_id IS NOT NULL AND promoted_record_id<>${sql(plannedDailyLogId(record.sourceId))})))=0`
  })
  const guardChecks = [
    `(SELECT COUNT(*) FROM projects WHERE id=${sql(fixture.projectId)} AND organization_id=${sql(fixture.organizationId)} AND project_number=${sql(fixture.projectNumber)} AND buildertrend_project_id=${sql(fixture.buildertrendJobId)})=1`,
    `(SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(fixture.projectId)} AND source_system='buildertrend')=${fixture.expectedExistingOperationalCount}`,
    ...mappingGuards,
    ...stagingIdentityGuards,
    `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(fixture.projectId)} AND buildertrend_job_id=${sql(fixture.buildertrendJobId)} AND source_record_type='daily_log' AND buildertrend_record_id NOT IN (${sourceIdsSql}))=0`,
    `(SELECT COUNT(*) FROM (SELECT buildertrend_record_id FROM buildertrend_staging_records WHERE project_id=${sql(fixture.projectId)} AND buildertrend_job_id=${sql(fixture.buildertrendJobId)} AND source_record_type='daily_log' AND promotion_status='promoted' GROUP BY buildertrend_record_id HAVING COUNT(*)>1))=0`,
    missingRecords.length > 0
      ? `(SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(fixture.projectId)} AND source_system='buildertrend' AND source_external_id IN (${missingIdsSql}))=0`
      : "1=1",
    missingRecords.length > 0
      ? `(SELECT COUNT(*) FROM daily_logs WHERE id IN (${plannedNewIdsSql}))=0`
      : "1=1",
  ]
  const guardStatements = []
  for (let index = 0; index < guardChecks.length; index += 40) {
    const guardBatch = guardChecks.slice(index, index + 40).join(" AND ")
    guardStatements.push(
      `INSERT INTO projects SELECT * FROM projects WHERE id=(SELECT id FROM projects ORDER BY id LIMIT 1) AND NOT (${guardBatch});`,
    )
  }
  const summary = JSON.stringify({
    projectId: fixture.projectId,
    projectNumber: fixture.projectNumber,
    buildertrendJobId: fixture.buildertrendJobId,
    sourceRecordCount: fixture.records.length,
    existingBuildertrendOperationalCount: fixture.expectedExistingOperationalCount,
    representedExistingCount: fixture.existingMappings.length,
    importedOperationalCount: missingRecords.length,
    sourceClientVisibleRecords: fixture.records.filter((record) => record.isClientVisible).length,
    automaticallyExposedClientRecords: 0,
    createsExternalLinks: false,
    removesLegacySourceUrlMetadata: true,
  })
  const statements = [
    ...guardStatements,
    `INSERT INTO buildertrend_staging_runs (id, organization_id, run_key, manifest_fingerprint, source_method, source_label, status, started_by, started_at, completed_at, raw_artifact_drive_file_id, raw_artifact_drive_url, source_notes, summary_json, created_at, updated_at) VALUES (${sql(runId)}, ${sql(fixture.organizationId)}, ${sql(runKey)}, ${sql(manifestFingerprint)}, 'authenticated_browser_capture', ${sql(fixture.sourceLabel)}, 'completed', NULL, ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}, NULL, NULL, 'Complete authenticated daily-log register capture. Operational rows contain no Buildertrend links.', ${sql(summary)}, ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}) ON CONFLICT(organization_id, run_key) DO UPDATE SET status='completed', completed_at=excluded.completed_at, summary_json=excluded.summary_json, updated_at=excluded.updated_at WHERE buildertrend_staging_runs.manifest_fingerprint=excluded.manifest_fingerprint;`,
  ]

  for (const record of missingRecords) {
    const dailyLogId = plannedDailyLogId(record.sourceId)
    const operationalTags = JSON.stringify({
      buildertrendProjectId: fixture.buildertrendJobId,
      destinationBuildertrendProjectId: fixture.buildertrendJobId,
      buildertrendAuthor: record.author,
      buildertrendTitle: titleDetail(record.title) || record.title,
      buildertrendDisplayTitle: record.title,
      buildertrendVisibility: record.visibility,
      buildertrendTags: record.tags,
      buildertrendWeather: record.weather,
      buildertrendMediaCount: record.mediaCount,
      buildertrendPhotoPreviewNames: record.displayedMedia.map((entry) => entry.fileName).filter(Boolean),
      buildertrendDocuments: record.documentNames,
      migrationDisposition: "import_to_mapped_project",
    })
    statements.push(
      `INSERT INTO daily_logs (id, project_id, author_id, source_system, source_external_id, log_date, weather_temp_f, weather_conditions, weather_precipitation, weather_source, work_completed, issues, materials_used, crew_present, hours_worked, safety_incidents, visitor_log, notes, is_client_visible, review_status, tags, sync_status, created_at, updated_at) VALUES (${sql(dailyLogId)}, ${sql(fixture.projectId)}, NULL, 'buildertrend', ${sql(record.sourceId)}, ${sql(record.logDate)}, ${sql(record.weatherTempF)}, NULL, NULL, 'buildertrend', ${sql(record.workCompleted)}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 'needs_review', ${sql(operationalTags)}, 'synced', ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)});`,
    )
  }

  for (const mapping of fixture.existingMappings) {
    const record = fixture.records.find(
      (candidate) => candidate.sourceId === mapping.sourceId,
    )
    if (!record) {
      throw new Error(`Mapping references unknown sourceId: ${mapping.sourceId}`)
    }
    statements.push(
      `UPDATE daily_logs SET tags=json_remove(tags, '$.sourceUrl'), updated_at=${sql(fixture.capturedAt)} WHERE id=${sql(mapping.existingDailyLogId)} AND project_id=${sql(fixture.projectId)} AND json_valid(tags) AND json_type(tags, '$.sourceUrl') IS NOT NULL;`,
      `UPDATE daily_logs SET tags=json_set(CASE WHEN json_valid(tags) THEN CASE WHEN json_type(tags)='object' THEN tags ELSE json_object('legacyTags', tags) END ELSE CASE WHEN tags IS NULL OR trim(tags)='' THEN '{}' ELSE json_object('legacyTags', tags) END END, '$.buildertrendAuthor', ${sql(record.author)}, '$.buildertrendWeather', json(${sql(JSON.stringify(record.weather))})), updated_at=${sql(fixture.capturedAt)} WHERE id=${sql(mapping.existingDailyLogId)} AND project_id=${sql(fixture.projectId)};`,
    )
  }

  for (const record of fixture.records) {
    const dailyLogId = plannedDailyLogId(record.sourceId)
    const recordId = `legacy-record:bt-src-daily-log-${fixture.buildertrendJobId}-${record.sourceId}`
    const sourceKey = recordId
    const payload = JSON.stringify({
      buildertrendJobId: fixture.buildertrendJobId,
      buildertrendRecordId: record.sourceId,
      title: record.title,
      author: record.author,
      logDate: record.logDate,
      visibility: record.visibility,
      tags: record.tags,
      weather: record.weather,
      workCompleted: record.workCompleted,
      mediaCount: record.mediaCount,
      displayedMedia: record.displayedMedia,
      documentNames: record.documentNames,
      capturedAt: fixture.capturedAt,
    })
    statements.push(
      `INSERT INTO buildertrend_staging_records (id, organization_id, source_key, requested_project_id, project_id, source_scope, source_record_type, buildertrend_job_id, buildertrend_lead_id, buildertrend_record_id, buildertrend_record_number, buildertrend_url, title, record_date, record_status, source_status, department_code, client_name, contact_name, contact_email, amount, searchable_text, normalized_summary, raw_payload_json, source_archive_drive_folder_id, source_archive_drive_file_id, source_archive_drive_url, verified_archive_drive_folder_id, verified_archive_drive_file_id, verified_archive_drive_url, review_status, promotion_status, promoted_record_type, promoted_record_id, sage_reconciliation_status, source_notes, review_notes, created_at, updated_at) VALUES (${sql(recordId)}, ${sql(fixture.organizationId)}, ${sql(sourceKey)}, ${sql(fixture.projectId)}, ${sql(fixture.projectId)}, 'job', 'daily_log', ${sql(fixture.buildertrendJobId)}, NULL, ${sql(record.sourceId)}, NULL, NULL, ${sql(record.title)}, ${sql(record.logDate)}, 'captured', ${sql(record.visibility.join(", "))}, ${sql(fixture.projectNumber.split("-")[0])}, NULL, ${sql(record.author)}, NULL, NULL, ${sql(`${record.title} ${record.author} ${record.tags.join(" ")} ${record.workCompleted}`)}, ${sql(`${record.title}; ${record.author}; ${record.mediaCount} media`)}, ${sql(payload)}, NULL, NULL, NULL, NULL, NULL, NULL, 'verified', 'promoted', 'daily_log', ${sql(dailyLogId)}, 'not_reviewed', 'Authenticated Buildertrend daily-log register capture.', 'Operational record is internal and contains no Buildertrend links; source visibility is preserved for review and attachments reconcile separately.', ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}) ON CONFLICT(organization_id, source_key) DO UPDATE SET project_id=excluded.project_id, title=excluded.title, record_date=excluded.record_date, source_status=excluded.source_status, contact_name=excluded.contact_name, searchable_text=excluded.searchable_text, normalized_summary=excluded.normalized_summary, raw_payload_json=excluded.raw_payload_json, review_status='verified', promotion_status=CASE WHEN buildertrend_staging_records.promoted_record_id IS NULL OR buildertrend_staging_records.promoted_record_id=excluded.promoted_record_id THEN 'promoted' ELSE buildertrend_staging_records.promotion_status END, promoted_record_type=CASE WHEN buildertrend_staging_records.promoted_record_id IS NULL OR buildertrend_staging_records.promoted_record_id=excluded.promoted_record_id THEN 'daily_log' ELSE buildertrend_staging_records.promoted_record_type END, promoted_record_id=CASE WHEN buildertrend_staging_records.promoted_record_id IS NULL OR buildertrend_staging_records.promoted_record_id=excluded.promoted_record_id THEN excluded.promoted_record_id ELSE buildertrend_staging_records.promoted_record_id END, updated_at=excluded.updated_at;`,
      `INSERT OR IGNORE INTO buildertrend_staging_observations (id, import_run_id, organization_id, entity_kind, entity_key, entity_id, observed_payload_json, observed_at) VALUES (${sql(`bt-observation-${captureDate}-${shortFingerprint}-${fixture.buildertrendJobId}-${record.sourceId}`)}, ${sql(runId)}, ${sql(fixture.organizationId)}, 'record', ${sql(sourceKey)}, ${sql(recordId)}, ${sql(payload)}, ${sql(fixture.capturedAt)});`,
    )
  }

  const attestationId = `bt-attestation-${fixture.projectId}-daily-logs`
  statements.push(
    `INSERT INTO buildertrend_module_attestations (id, organization_id, project_id, import_run_id, module_key, status, observed_count, manifest_fingerprint, evidence_drive_file_id, evidence_drive_url, source_label, checked_at, verified_by, notes, created_at, updated_at) VALUES (${sql(attestationId)}, ${sql(fixture.organizationId)}, ${sql(fixture.projectId)}, ${sql(runId)}, 'daily_logs', 'captured', ${fixture.records.length}, ${sql(manifestFingerprint)}, NULL, NULL, ${sql(fixture.sourceLabel)}, ${sql(fixture.capturedAt)}, NULL, 'Complete authenticated source register; operational attachments reconcile separately.', ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}) ON CONFLICT(organization_id, project_id, module_key) DO UPDATE SET import_run_id=excluded.import_run_id, status='captured', observed_count=excluded.observed_count, manifest_fingerprint=excluded.manifest_fingerprint, source_label=excluded.source_label, checked_at=excluded.checked_at, notes=excluded.notes, updated_at=excluded.updated_at;`,
    `SELECT ${sql(fixture.projectId)} AS project_id, ${fixture.records.length} AS expected_source_records, ${missingRecords.length} AS expected_new_operational_records, (SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(fixture.projectId)} AND source_system='buildertrend') AS buildertrend_operational_records, (SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(fixture.projectId)} AND buildertrend_job_id=${sql(fixture.buildertrendJobId)} AND source_record_type='daily_log' AND promotion_status='promoted') AS promoted_source_records, (SELECT COUNT(*) FROM buildertrend_staging_records source JOIN daily_logs operational ON operational.id=source.promoted_record_id AND operational.project_id=${sql(fixture.projectId)} WHERE source.project_id=${sql(fixture.projectId)} AND source.buildertrend_job_id=${sql(fixture.buildertrendJobId)} AND source.source_record_type='daily_log' AND source.promotion_status='promoted') AS represented_source_records, (SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(fixture.projectId)} AND source_system='buildertrend' AND instr(tags, 'buildertrend' || '.net') > 0) AS operational_buildertrend_links;`,
  )
  return `${statements.join("\n")}\n`
}

export function summarizeBuildertrendDailyLogRegisterImport(input) {
  const fixture = validateFixture(input)
  return {
    projectId: fixture.projectId,
    projectNumber: fixture.projectNumber,
    buildertrendJobId: fixture.buildertrendJobId,
    sourceRecordCount: fixture.records.length,
    existingBuildertrendOperationalCount: fixture.expectedExistingOperationalCount,
    representedExistingCount: fixture.existingMappings.length,
    importedOperationalCount: fixture.records.length - fixture.existingMappings.length,
    sourceClientVisibleRecords: fixture.records.filter((record) => record.isClientVisible).length,
    automaticallyExposedClientRecords: 0,
    declaredMediaCount: fixture.records.reduce((total, record) => total + record.mediaCount, 0),
    createsExternalLinks: false,
    removesLegacySourceUrlMetadata: true,
  }
}
