import { createHash } from "node:crypto"

const PROJECT_ID = "proj-bt-o-58-3674-forest"
const ORGANIZATION_ID = "org-1"
const PROJECT_NUMBER = "O-58-3674"
const BUILDERTREND_JOB_ID = "5072748"
const CURRENT_SCHEDULE_CAPTURE = "2026-08-27T04:57:12.745Z"
const PRIOR_ONLY_SCHEDULE_IDS = ["174070312", "218342443"]

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`)
  }
  return value.trim()
}

function sql(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite SQL number")
    return String(value)
  }
  if (typeof value === "boolean") return value ? "1" : "0"
  if (typeof value === "object") return sql(JSON.stringify(value))
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

function isoDate(value, label) {
  const date = requiredString(value, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label} must be YYYY-MM-DD`)
  return date
}

function validateFixture(input) {
  if (
    input?.project?.projectId !== PROJECT_ID ||
    input?.project?.organizationId !== ORGANIZATION_ID ||
    input?.project?.projectNumber !== PROJECT_NUMBER ||
    input?.project?.buildertrendJobId !== BUILDERTREND_JOB_ID
  ) {
    throw new Error("Fixture does not target the protected O-58-3674 project")
  }
  if (input.currentSchedule?.capturedAt !== CURRENT_SCHEDULE_CAPTURE) {
    throw new Error("Only the latest authorized live Buildertrend schedule may be imported")
  }
  if (!Array.isArray(input.currentSchedule.activities) || input.currentSchedule.activities.length !== 230) {
    throw new Error("Current schedule must contain exactly 230 activities")
  }
  if (!Array.isArray(input.weatherEvents) || input.weatherEvents.length !== 77) {
    throw new Error("Operational cutover must contain exactly 77 neutral weather records")
  }
  if (!Array.isArray(input.procurementEvents) || input.procurementEvents.length !== 7) {
    throw new Error("Operational cutover must contain exactly 7 Fox procurement records")
  }

  const sourceIds = new Set()
  const taskIds = new Set()
  const sortOrders = new Set()
  for (const activity of input.currentSchedule.activities) {
    const sourceId = requiredString(activity.sourceRecordId, "schedule sourceRecordId")
    const taskId = requiredString(activity.compassTaskId, "schedule compassTaskId")
    if (!/^\d+$/.test(sourceId)) throw new Error(`Invalid Buildertrend activity ID ${sourceId}`)
    if (sourceIds.has(sourceId)) throw new Error(`Duplicate Buildertrend activity ID ${sourceId}`)
    if (taskIds.has(taskId)) throw new Error(`Duplicate Compass schedule task ID ${taskId}`)
    if (!Number.isSafeInteger(activity.sortOrder) || activity.sortOrder < 1) {
      throw new Error(`Invalid sort order for activity ${sourceId}`)
    }
    if (sortOrders.has(activity.sortOrder)) throw new Error(`Duplicate schedule sort order ${activity.sortOrder}`)
    if (!Number.isSafeInteger(activity.workdays) || activity.workdays < 1) {
      throw new Error(`Invalid workdays for activity ${sourceId}`)
    }
    if (!Number.isSafeInteger(activity.percentComplete) || activity.percentComplete < 0 || activity.percentComplete > 100) {
      throw new Error(`Invalid completion percent for activity ${sourceId}`)
    }
    isoDate(activity.startDate, `startDate for ${sourceId}`)
    isoDate(activity.endDate, `endDate for ${sourceId}`)
    if (activity.endDate < activity.startDate) throw new Error(`End date precedes start date for ${sourceId}`)
    const expectedUrl = `/Schedule/${sourceId}/${BUILDERTREND_JOB_ID}`
    if (!requiredString(activity.sourceUrl, "schedule sourceUrl").includes(expectedUrl)) {
      throw new Error(`Unexpected Buildertrend schedule URL for ${sourceId}`)
    }
    sourceIds.add(sourceId)
    taskIds.add(taskId)
    sortOrders.add(activity.sortOrder)
  }

  const neutralTerms = /\b(delay|stall|impact|no[- ]work|not conducive|caus(?:e|ed|ation))\b/i
  const weatherKeys = new Set()
  for (const event of input.weatherEvents) {
    requiredString(event.id, "weather id")
    const sourceKey = requiredString(event.sourceKey, "weather sourceKey")
    if (weatherKeys.has(sourceKey)) throw new Error(`Duplicate weather source key ${sourceKey}`)
    if (neutralTerms.test(event.conditions ?? "") || neutralTerms.test(event.sourceLimitation ?? "")) {
      throw new Error(`Weather event ${sourceKey} contains analytical wording`)
    }
    isoDate(event.date, `weather date for ${sourceKey}`)
    weatherKeys.add(sourceKey)
  }

  const procurementKeys = new Set()
  for (const event of input.procurementEvents) {
    requiredString(event.id, "procurement id")
    const sourceKey = requiredString(event.sourceKey, "procurement sourceKey")
    if (procurementKeys.has(sourceKey)) throw new Error(`Duplicate procurement source key ${sourceKey}`)
    isoDate(event.date, `procurement date for ${sourceKey}`)
    if (!Array.isArray(event.attachments) || event.attachments.length === 0) {
      throw new Error(`Procurement event ${sourceKey} requires a source attachment`)
    }
    procurementKeys.add(sourceKey)
  }

  const baseline = input.protectedBaseline
  const exactCounts = {
    dailyLogs: 249,
    scheduleItems: 230,
    changeOrders: 28,
    rfis: 1,
    rfqs: 0,
    estimateHeaders: 1,
    estimateCategories: 37,
    estimateLineItems: 90,
    messages: 227,
    payRequestSourceRecords: 21,
  }
  for (const [key, expected] of Object.entries(exactCounts)) {
    if (baseline?.[key] !== expected) throw new Error(`Protected baseline ${key} must equal ${expected}`)
  }
  if (baseline.excludedDailyLogSourceId !== "85012183") {
    throw new Error("Protected daily-log exclusion changed")
  }
  return input
}

function schedulePayload(fixture, activity) {
  return {
    buildertrendJobId: fixture.project.buildertrendJobId,
    buildertrendRecordId: activity.sourceRecordId,
    capturedAt: fixture.currentSchedule.capturedAt,
    currentSchedule: true,
    title: activity.title,
    startDate: activity.startDate,
    endDate: activity.endDate,
    workdays: activity.workdays,
    phase: activity.phase,
    status: activity.status,
    percentComplete: activity.percentComplete,
    assignedTo: activity.assignedTo,
    sortOrder: activity.sortOrder,
    sourceUrl: activity.sourceUrl,
    rawSource: activity.rawSource,
  }
}

function observed(value, suffix) {
  return value === null || value === undefined ? "not available" : `${value}${suffix}`
}

function weatherWorkCompleted(event) {
  const parts = [`Weather observation: ${event.conditions ?? "condition not available"}`]
  if (event.temperatureMinF !== null || event.temperatureMaxF !== null) {
    parts.push(`minimum ${observed(event.temperatureMinF, " F")}; maximum ${observed(event.temperatureMaxF, " F")}`)
  }
  if (event.precipitationIn !== null) parts.push(`precipitation ${event.precipitationIn} in`)
  if (event.rainIn !== null) parts.push(`rain ${event.rainIn} in`)
  if (event.snowIn !== null) parts.push(`snowfall ${event.snowIn} in`)
  if (event.snowDepthIn !== null) parts.push(`snow depth ${event.snowDepthIn} in`)
  if (event.freezingPrecipitationIn !== null) parts.push(`freezing precipitation ${event.freezingPrecipitationIn} in`)
  if (event.sustainedSubfreezingHours !== null) parts.push(`sustained subfreezing period ${event.sustainedSubfreezingHours} hours`)
  if (event.windSummary) parts.push(`wind ${event.windSummary}`)
  return `${parts.join("; ")}.`
}

function weatherNotes(event, importedAt) {
  const station = event.stationOrGrid ?? "station/grid not available"
  const distance = observed(event.stationDistanceMiles, " miles from site")
  const elevation = observed(event.stationElevationDifferenceFeet, " feet elevation difference")
  const hourly = event.hourlyTemperatureSummary ?? "not available"
  return [
    `Provider/source: ${event.provider}; ${station}; ${event.sourceKind}.`,
    `Source URL: ${event.sourceUrl}.`,
    `Site timezone: ${event.timezone}; working-hours window ${event.workingWindowStart}-${event.workingWindowEnd}; hourly temperature summary: ${hourly}.`,
    `Observation period: ${event.observationPeriod ?? "not available"}; cutoff: ${event.observationCutoff ?? "not available"}.`,
    `Station relationship: ${distance}; ${elevation}.`,
    `Imported ${importedAt}. Source limitation: ${event.sourceLimitation}`,
    "Unreported values remain not available.",
  ].join(" ")
}

function weatherPrecipitation(event) {
  const parts = []
  if (event.precipitationIn !== null) parts.push(`${event.precipitationIn} in precipitation`)
  if (event.rainIn !== null) parts.push(`${event.rainIn} in rain`)
  if (event.snowIn !== null) parts.push(`${event.snowIn} in snow`)
  if (event.snowDepthIn !== null) parts.push(`${event.snowDepthIn} in snow depth`)
  if (event.freezingPrecipitationIn !== null) parts.push(`${event.freezingPrecipitationIn} in freezing precipitation`)
  return parts.length > 0 ? parts.join("; ") : null
}

export function summarizeO583674OperationalCutover(input) {
  const fixture = validateFixture(input)
  return {
    projectId: fixture.project.projectId,
    buildertrendJobId: fixture.project.buildertrendJobId,
    currentScheduleCapturedAt: fixture.currentSchedule.capturedAt,
    scheduleActivities: fixture.currentSchedule.activities.length,
    protectedBuildertrendDailyLogs: fixture.protectedBaseline.dailyLogs,
    neutralWeatherDailyLogs: fixture.weatherEvents.length,
    procurementDailyLogs: fixture.procurementEvents.length,
    procurementAttachments: fixture.procurementEvents.reduce(
      (count, event) => count + event.attachments.length,
      0
    ),
    buildertrendWrites: 0,
    preExistingImmutablePriorOnlySourceRows: 2,
    importedPriorScheduleRows: 0,
    deletes: 0,
    historicalScheduleSnapshots: 0,
    derivedReviewRecords: 0,
    nonOperationalDocuments: 0,
    manifestFingerprint: fingerprint(fixture),
  }
}

export function generateO583674OperationalCutover(input) {
  const fixture = validateFixture(input)
  const capturedAt = fixture.currentSchedule.capturedAt
  const importedAt = fixture.generatedAt
  const manifestFingerprint = fingerprint(fixture)
  const scheduleTaskIds = fixture.currentSchedule.activities.map((activity) => activity.compassTaskId)
  const scheduleSourceIds = fixture.currentSchedule.activities.map((activity) => activity.sourceRecordId)
  const scheduleTaskIdsSql = scheduleTaskIds.map(sql).join(", ")
  const scheduleSourceIdsSql = scheduleSourceIds.map(sql).join(", ")
  const weatherIdsSql = fixture.weatherEvents.map((event) => sql(event.id)).join(", ")
  const procurementIdsSql = fixture.procurementEvents.map((event) => sql(event.id)).join(", ")
  const procurementAttachmentIds = fixture.procurementEvents.flatMap((event) =>
    event.attachments.map((attachment) =>
      `fox-source-${fingerprint({ event: event.id, source: attachment.driveFileId }).slice(0, 24)}`
    )
  )
  const procurementAttachmentIdsSql = procurementAttachmentIds.map(sql).join(", ")
  const runId = `bt-current-schedule-${BUILDERTREND_JOB_ID}-20260827-${manifestFingerprint.slice(0, 12)}`
  const runKey = `current-schedule:${BUILDERTREND_JOB_ID}:${CURRENT_SCHEDULE_CAPTURE}:${manifestFingerprint.slice(0, 12)}`

  const guards = [
    `(SELECT COUNT(*) FROM projects WHERE id=${sql(PROJECT_ID)} AND organization_id=${sql(ORGANIZATION_ID)} AND project_number=${sql(PROJECT_NUMBER)} AND name=${sql(fixture.project.projectName)} AND buildertrend_project_id=${sql(BUILDERTREND_JOB_ID)})=1`,
    `(SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='buildertrend')=249`,
    `(SELECT COALESCE(SUM(LENGTH(source_external_id)),0) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='buildertrend')=1992`,
    `(SELECT COALESCE(SUM(LENGTH(work_completed)),0) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='buildertrend')=40814`,
    `(SELECT COALESCE(SUM(LENGTH(created_at)),0) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='buildertrend')=5976`,
    `(SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_external_id=${sql(fixture.protectedBaseline.excludedDailyLogSourceId)})=0`,
    `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='schedule_item') IN (230,232)`,
    `(((SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='schedule_item' AND buildertrend_record_id IN (${scheduleSourceIdsSql}))=228 AND (SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='schedule_item' AND buildertrend_record_id IN (${PRIOR_ONLY_SCHEDULE_IDS.map(sql).join(", ")}))=2) OR ((SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='schedule_item' AND buildertrend_record_id IN (${scheduleSourceIdsSql}))=230 AND (SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='schedule_item' AND buildertrend_record_id IN (${PRIOR_ONLY_SCHEDULE_IDS.map(sql).join(", ")}))=2))`,
    `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='change_order')=28`,
    `(SELECT COALESCE(SUM(LENGTH(buildertrend_record_id)),0) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='change_order')=196`,
    `(SELECT COALESCE(SUM(LENGTH(raw_payload_json)),0) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='change_order')=21518`,
    `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='rfi')=1`,
    `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='rfq')=0`,
    `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='estimate')=1`,
    `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='estimate_category')=37`,
    `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='estimate_line_item')=90`,
    `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='message')=227`,
    `(SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='owner_invoice')=21`,
    `(SELECT COUNT(*) FROM schedule_tasks WHERE project_id=${sql(PROJECT_ID)}) IN (0,230)`,
    `(SELECT COUNT(*) FROM schedule_tasks WHERE project_id=${sql(PROJECT_ID)} AND id IN (${scheduleTaskIdsSql}))=(SELECT COUNT(*) FROM schedule_tasks WHERE project_id=${sql(PROJECT_ID)})`,
    `(SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='weather_observation') IN (0,77)`,
    `(SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='weather_observation' AND id IN (${weatherIdsSql}))=(SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='weather_observation')`,
    `(SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='procurement_evidence') IN (0,7)`,
    `(SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='procurement_evidence' AND id IN (${procurementIdsSql}))=(SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='procurement_evidence')`,
    `(SELECT COUNT(*) FROM daily_log_photos WHERE project_id=${sql(PROJECT_ID)} AND source_system='google_drive_reference' AND id LIKE 'fox-source-%') IN (0,12)`,
    `(SELECT COUNT(*) FROM daily_log_photos WHERE project_id=${sql(PROJECT_ID)} AND source_system='google_drive_reference' AND id LIKE 'fox-source-%' AND id IN (${procurementAttachmentIdsSql}))=(SELECT COUNT(*) FROM daily_log_photos WHERE project_id=${sql(PROJECT_ID)} AND source_system='google_drive_reference' AND id LIKE 'fox-source-%')`,
  ]

  const statements = [
    `INSERT INTO projects SELECT * FROM projects WHERE id=${sql(PROJECT_ID)} AND NOT (${guards.join(" AND ")});`,
    `INSERT INTO buildertrend_staging_runs (id, organization_id, run_key, manifest_fingerprint, source_method, source_label, status, started_by, started_at, completed_at, raw_artifact_drive_file_id, raw_artifact_drive_url, source_notes, summary_json, created_at, updated_at) VALUES (${sql(runId)}, ${sql(ORGANIZATION_ID)}, ${sql(runKey)}, ${sql(manifestFingerprint)}, 'authenticated_browser_capture', ${sql(fixture.currentSchedule.sourceLabel)}, 'completed', NULL, ${sql(capturedAt)}, ${sql(capturedAt)}, NULL, NULL, 'Current live Buildertrend schedule only. No prior schedule snapshot or comparison imported.', ${sql({ projectId: PROJECT_ID, buildertrendJobId: BUILDERTREND_JOB_ID, activityCount: 230, currentScheduleOnly: true })}, ${sql(importedAt)}, ${sql(importedAt)}) ON CONFLICT(organization_id, run_key) DO UPDATE SET status='completed', completed_at=excluded.completed_at, summary_json=excluded.summary_json, updated_at=excluded.updated_at WHERE buildertrend_staging_runs.manifest_fingerprint=excluded.manifest_fingerprint;`,
  ]

  for (const activity of fixture.currentSchedule.activities) {
    const payload = schedulePayload(fixture, activity)
    const recordId = `legacy-record:bt-source-schedule-${BUILDERTREND_JOB_ID}-${activity.sourceRecordId}`
    const sourceKey = recordId
    statements.push(
      `INSERT INTO schedule_tasks (id, project_id, title, start_date, workdays, end_date_calculated, phase, status, is_critical_path, is_milestone, percent_complete, assigned_to, sort_order, created_at, updated_at) VALUES (${sql(activity.compassTaskId)}, ${sql(PROJECT_ID)}, ${sql(activity.title)}, ${sql(activity.startDate)}, ${sql(activity.workdays)}, ${sql(activity.endDate)}, ${sql(activity.phase)}, ${sql(activity.status)}, 0, 0, ${sql(activity.percentComplete)}, ${sql(activity.assignedTo)}, ${sql(activity.sortOrder)}, ${sql(importedAt)}, ${sql(importedAt)}) ON CONFLICT(id) DO UPDATE SET title=excluded.title, start_date=excluded.start_date, workdays=excluded.workdays, end_date_calculated=excluded.end_date_calculated, phase=excluded.phase, status=excluded.status, percent_complete=excluded.percent_complete, assigned_to=excluded.assigned_to, sort_order=excluded.sort_order, updated_at=excluded.updated_at WHERE schedule_tasks.project_id=excluded.project_id;`,
      `INSERT INTO buildertrend_staging_records (id, organization_id, source_key, requested_project_id, project_id, source_scope, source_record_type, buildertrend_job_id, buildertrend_lead_id, buildertrend_record_id, buildertrend_record_number, buildertrend_url, title, record_date, record_status, source_status, department_code, client_name, contact_name, contact_email, amount, searchable_text, normalized_summary, raw_payload_json, source_archive_drive_folder_id, source_archive_drive_file_id, source_archive_drive_url, verified_archive_drive_folder_id, verified_archive_drive_file_id, verified_archive_drive_url, review_status, promotion_status, promoted_record_type, promoted_record_id, sage_reconciliation_status, source_notes, review_notes, created_at, updated_at) VALUES (${sql(recordId)}, ${sql(ORGANIZATION_ID)}, ${sql(sourceKey)}, ${sql(PROJECT_ID)}, ${sql(PROJECT_ID)}, 'job', 'schedule_item', ${sql(BUILDERTREND_JOB_ID)}, NULL, ${sql(activity.sourceRecordId)}, ${sql(String(activity.sortOrder))}, ${sql(activity.sourceUrl)}, ${sql(activity.title)}, ${sql(activity.startDate)}, ${sql(activity.status.toLowerCase())}, ${sql(`${activity.percentComplete}%`)}, 'O', NULL, NULL, NULL, NULL, ${sql(`${activity.title} ${activity.phase}`)}, ${sql(`${activity.title}; ${activity.startDate} to ${activity.endDate}; ${activity.percentComplete}%`)}, ${sql(payload)}, NULL, NULL, NULL, NULL, NULL, NULL, 'verified', 'promoted', 'schedule_task', ${sql(activity.compassTaskId)}, 'not_reviewed', 'Current authenticated Buildertrend schedule capture.', 'Current schedule only; no prior capture or comparison imported.', ${sql(importedAt)}, ${sql(importedAt)}) ON CONFLICT(id) DO UPDATE SET buildertrend_record_number=excluded.buildertrend_record_number, buildertrend_url=excluded.buildertrend_url, title=excluded.title, record_date=excluded.record_date, record_status=excluded.record_status, source_status=excluded.source_status, searchable_text=excluded.searchable_text, normalized_summary=excluded.normalized_summary, raw_payload_json=excluded.raw_payload_json, review_status='verified', promotion_status='promoted', promoted_record_type='schedule_task', promoted_record_id=excluded.promoted_record_id, source_notes=excluded.source_notes, review_notes=excluded.review_notes, updated_at=excluded.updated_at WHERE buildertrend_staging_records.organization_id=excluded.organization_id AND buildertrend_staging_records.project_id=excluded.project_id AND buildertrend_staging_records.buildertrend_job_id=excluded.buildertrend_job_id AND buildertrend_staging_records.source_record_type='schedule_item' AND buildertrend_staging_records.buildertrend_record_id=excluded.buildertrend_record_id;`,
      `INSERT INTO schedule_task_links (id, schedule_task_id, project_id, resource_type, resource_id, label, href, created_by, created_at) VALUES (${sql(`bt-schedule-link-${BUILDERTREND_JOB_ID}-${activity.sourceRecordId}`)}, ${sql(activity.compassTaskId)}, ${sql(PROJECT_ID)}, 'buildertrend', ${sql(activity.sourceRecordId)}, 'Buildertrend schedule activity', ${sql(activity.sourceUrl)}, NULL, ${sql(importedAt)}) ON CONFLICT(id) DO UPDATE SET label=excluded.label, href=excluded.href WHERE schedule_task_links.project_id=excluded.project_id AND schedule_task_links.schedule_task_id=excluded.schedule_task_id;`
    )
  }

  statements.push(
    `INSERT INTO buildertrend_module_attestations (id, organization_id, project_id, import_run_id, module_key, status, observed_count, manifest_fingerprint, evidence_drive_file_id, evidence_drive_url, source_label, checked_at, verified_by, notes, created_at, updated_at) VALUES ('bt-module-o583674-current-schedule', ${sql(ORGANIZATION_ID)}, ${sql(PROJECT_ID)}, ${sql(runId)}, 'schedules', 'captured', 230, ${sql(manifestFingerprint)}, NULL, NULL, ${sql(fixture.currentSchedule.sourceLabel)}, ${sql(capturedAt)}, NULL, 'Current live schedule imported through the standard schedule task and Buildertrend staging mechanisms.', ${sql(importedAt)}, ${sql(importedAt)}) ON CONFLICT(organization_id, project_id, module_key) DO UPDATE SET import_run_id=excluded.import_run_id, status='captured', observed_count=excluded.observed_count, manifest_fingerprint=excluded.manifest_fingerprint, source_label=excluded.source_label, checked_at=excluded.checked_at, notes=excluded.notes, updated_at=excluded.updated_at;`
  )

  for (const event of fixture.weatherEvents) {
    const maxTemp = event.temperatureMaxF === null ? null : Math.round(event.temperatureMaxF)
    statements.push(
      `INSERT INTO daily_logs (id, project_id, author_id, source_system, source_external_id, log_date, weather_temp_f, weather_conditions, weather_precipitation, weather_source, work_completed, issues, materials_used, crew_present, hours_worked, safety_incidents, visitor_log, notes, is_client_visible, review_status, tags, sync_status, created_at, updated_at) SELECT ${sql(event.id)}, ${sql(PROJECT_ID)}, NULL, 'weather_observation', ${sql(event.sourceKey)}, ${sql(event.date)}, ${sql(maxTemp)}, ${sql(event.conditions)}, ${sql(weatherPrecipitation(event))}, ${sql(`${event.provider}${event.stationOrGrid ? ` / ${event.stationOrGrid}` : ""}`)}, ${sql(weatherWorkCompleted(event))}, NULL, NULL, NULL, NULL, NULL, NULL, ${sql(weatherNotes(event, importedAt))}, 0, 'approved', '["weather-observation","source-fact"]', 'synced', ${sql(importedAt)}, ${sql(importedAt)} WHERE NOT EXISTS (SELECT 1 FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='weather_observation' AND source_external_id=${sql(event.sourceKey)});`
    )
  }

  for (const event of fixture.procurementEvents) {
    statements.push(
      `INSERT INTO daily_logs (id, project_id, author_id, source_system, source_external_id, log_date, weather_temp_f, weather_conditions, weather_precipitation, weather_source, work_completed, issues, materials_used, crew_present, hours_worked, safety_incidents, visitor_log, notes, is_client_visible, review_status, tags, sync_status, created_at, updated_at) SELECT ${sql(event.id)}, ${sql(PROJECT_ID)}, NULL, 'procurement_evidence', ${sql(event.sourceKey)}, ${sql(event.date)}, NULL, NULL, NULL, 'not_applicable', ${sql(event.workCompleted)}, NULL, NULL, NULL, NULL, NULL, NULL, ${sql(event.notes)}, 0, 'approved', '["fox-blocks","procurement","source-fact"]', 'synced', ${sql(importedAt)}, ${sql(importedAt)} WHERE NOT EXISTS (SELECT 1 FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='procurement_evidence' AND source_external_id=${sql(event.sourceKey)});`
    )
    for (const [index, attachment] of event.attachments.entries()) {
      const attachmentId = `fox-source-${fingerprint({ event: event.id, source: attachment.driveFileId }).slice(0, 24)}`
      statements.push(
        `INSERT INTO daily_log_photos (id, project_id, daily_log_id, uploaded_by, source_system, source_external_id, file_name, file_size, mime_type, drive_file_id, drive_url, thumbnail_url, caption, captured_at, gps_lat, gps_lng, upload_status, review_status, owner_visible, sub_vendor_visible, public_shareable, photo_kind, schedule_phase_override, sort_order, created_at, updated_at) SELECT ${sql(attachmentId)}, ${sql(PROJECT_ID)}, ${sql(event.id)}, NULL, 'google_drive_reference', ${sql(attachment.driveFileId)}, ${sql(attachment.title)}, NULL, NULL, ${sql(attachment.driveFileId)}, ${sql(attachment.url)}, NULL, 'Operational procurement source reference; no credentials or download token stored.', ${sql(event.date)}, NULL, NULL, 'linked', 'approved', 0, 0, 0, 'document_reference', NULL, ${sql(index)}, ${sql(importedAt)}, ${sql(importedAt)} WHERE EXISTS (SELECT 1 FROM daily_logs WHERE id=${sql(event.id)} AND project_id=${sql(PROJECT_ID)}) ON CONFLICT(id) DO UPDATE SET drive_url=excluded.drive_url, file_name=excluded.file_name, caption=excluded.caption WHERE daily_log_photos.project_id=excluded.project_id AND daily_log_photos.daily_log_id=excluded.daily_log_id;`
      )
    }
  }

  statements.push(
    `SELECT ${sql(PROJECT_ID)} AS project_id, (SELECT COUNT(*) FROM schedule_tasks WHERE project_id=${sql(PROJECT_ID)}) AS current_schedule_tasks, (SELECT COUNT(*) FROM buildertrend_staging_records WHERE project_id=${sql(PROJECT_ID)} AND buildertrend_job_id=${sql(BUILDERTREND_JOB_ID)} AND source_record_type='schedule_item' AND promotion_status='promoted') AS promoted_schedule_sources, (SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='buildertrend') AS protected_buildertrend_daily_logs, (SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='weather_observation') AS neutral_weather_logs, (SELECT COUNT(*) FROM daily_logs WHERE project_id=${sql(PROJECT_ID)} AND source_system='procurement_evidence') AS procurement_logs, (SELECT COUNT(*) FROM daily_log_photos WHERE project_id=${sql(PROJECT_ID)} AND source_system='google_drive_reference' AND id LIKE 'fox-source-%') AS procurement_source_links;`
  )

  const canonicalSql = [
    "BEGIN IMMEDIATE;",
    "-- Current operational Buildertrend schedule plus ordinary neutral-weather and procurement daily logs.",
    "-- No prior schedule capture, comparison, derived review record, or non-operational document.",
    ...statements,
    "COMMIT;",
    "",
  ].join("\n")
  return {
    statements,
    guardChecks: guards,
    canonicalSql,
    summary: summarizeO583674OperationalCutover(fixture),
  }
}
