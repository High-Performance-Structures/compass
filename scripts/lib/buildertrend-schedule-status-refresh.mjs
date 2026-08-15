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

function scheduleStatus(percent) {
  if (percent === 100) return "COMPLETE"
  if (percent > 0) return "IN_PROGRESS"
  return "PENDING"
}

function sourceStatus(percent) {
  return scheduleStatus(percent).toLowerCase()
}

function caseBySourceRecordId(items, valueForItem, sourceColumn = "source.buildertrend_record_id") {
  return `CASE ${sourceColumn} ${items
    .map((item) => `WHEN ${sql(item.sourceRecordId)} THEN ${sql(valueForItem(item))}`)
    .join(" ")} END`
}

function validateSourceHref(value, recordId, jobId) {
  const href = requiredString(value, "sourceHref")
  const match = href.match(/^\/app\/Schedules\/\d+\/Schedule\/(\d+)\/(\d+)$/)
  if (!match || match[1] !== recordId || match[2] !== jobId) {
    throw new Error(`Unexpected Buildertrend schedule href for ${recordId}`)
  }
}

function validateFixture(input) {
  const organizationId = requiredString(input.organizationId, "organizationId")
  const projectId = requiredString(input.projectId, "projectId")
  const projectNumber = requiredString(input.projectNumber, "projectNumber")
  const buildertrendJobId = requiredString(
    input.buildertrendJobId,
    "buildertrendJobId",
  )
  const capturedAt = requiredString(input.capturedAt, "capturedAt")
  const sourceLabel = requiredString(input.sourceLabel, "sourceLabel")
  if (Number.isNaN(new Date(capturedAt).getTime())) {
    throw new Error("capturedAt is invalid")
  }
  if (!Number.isSafeInteger(input.expectedCompassTaskCount) || input.expectedCompassTaskCount <= 0) {
    throw new Error("expectedCompassTaskCount must be a positive integer")
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("items must be a non-empty array")
  }
  if (input.expectedCompassTaskCount < input.items.length) {
    throw new Error("expectedCompassTaskCount cannot be smaller than source item count")
  }

  const recordIds = new Set()
  const items = input.items.map((item) => {
    const sourceRecordId = requiredString(item.sourceRecordId, "sourceRecordId")
    const title = requiredString(item.title, "title")
    if (!/^\d+$/.test(sourceRecordId)) {
      throw new Error(`Invalid sourceRecordId: ${sourceRecordId}`)
    }
    if (recordIds.has(sourceRecordId)) {
      throw new Error(`Duplicate sourceRecordId: ${sourceRecordId}`)
    }
    recordIds.add(sourceRecordId)
    if (!Number.isSafeInteger(item.percent) || item.percent < 0 || item.percent > 100) {
      throw new Error(`Invalid percent for ${sourceRecordId}`)
    }
    validateSourceHref(item.sourceHref, sourceRecordId, buildertrendJobId)
    return {
      sourceRecordId,
      title,
      percent: item.percent,
      status: scheduleStatus(item.percent),
    }
  })

  return {
    organizationId,
    projectId,
    projectNumber,
    buildertrendJobId,
    capturedAt,
    sourceLabel,
    expectedCompassTaskCount: input.expectedCompassTaskCount,
    items,
  }
}

export function generateBuildertrendScheduleStatusRefreshSql(input) {
  const fixture = validateFixture(input)
  const captureDate = fixture.capturedAt.slice(0, 10).replaceAll("-", "")
  const manifestFingerprint = fingerprint(fixture)
  const captureFingerprint = manifestFingerprint.slice(0, 12)
  const runId = `bt-schedule-status-${fixture.buildertrendJobId}-${captureDate}-${captureFingerprint}`
  const runKey = `schedule-status:${fixture.buildertrendJobId}:${captureDate}:${captureFingerprint}`
  const sourceRecordIdsSql = fixture.items
    .map((item) => sql(item.sourceRecordId))
    .join(", ")
  const promotedScopeSql = `source.organization_id=${sql(fixture.organizationId)} AND source.buildertrend_job_id=${sql(fixture.buildertrendJobId)} AND source.source_record_type='schedule_item' AND source.promotion_status='promoted' AND source.promoted_record_id IS NOT NULL`
  const guardSql = [
    `(SELECT COUNT(*) FROM projects WHERE id=${sql(fixture.projectId)} AND organization_id=${sql(fixture.organizationId)} AND project_number=${sql(fixture.projectNumber)} AND buildertrend_project_id=${sql(fixture.buildertrendJobId)})=1`,
    `(SELECT COUNT(*) FROM schedule_tasks WHERE project_id=${sql(fixture.projectId)})=${fixture.expectedCompassTaskCount}`,
    `(SELECT COUNT(*) FROM buildertrend_staging_records source WHERE ${promotedScopeSql})=${fixture.items.length}`,
    `(SELECT COUNT(DISTINCT source.promoted_record_id) FROM buildertrend_staging_records source WHERE ${promotedScopeSql})=${fixture.items.length}`,
    // Staff may intentionally edit a task title in Compass. Guard the immutable
    // Buildertrend source IDs and their live task mappings without overwriting
    // or rejecting those Compass-owned title changes.
    `(SELECT COUNT(*) FROM buildertrend_staging_records source JOIN schedule_tasks task ON task.id=source.promoted_record_id AND task.project_id=${sql(fixture.projectId)} WHERE ${promotedScopeSql} AND source.buildertrend_record_id IN (${sourceRecordIdsSql}))=${fixture.items.length}`,
  ].join(" AND ")
  const summary = JSON.stringify({
    projectId: fixture.projectId,
    projectNumber: fixture.projectNumber,
    buildertrendJobId: fixture.buildertrendJobId,
    sourceItemCount: fixture.items.length,
    expectedCompassTaskCount: fixture.expectedCompassTaskCount,
    statusOnly: true,
    createsExternalLinks: false,
  })
  const statements = [
    // Abort before mutation when project, task, or promoted source identity has drifted.
    `INSERT INTO projects SELECT * FROM projects WHERE id=(SELECT id FROM projects ORDER BY id LIMIT 1) AND NOT (${guardSql});`,
    `INSERT INTO buildertrend_staging_runs (id, organization_id, run_key, manifest_fingerprint, source_method, source_label, status, started_by, started_at, completed_at, raw_artifact_drive_file_id, raw_artifact_drive_url, source_notes, summary_json, created_at, updated_at) VALUES (${sql(runId)}, ${sql(fixture.organizationId)}, ${sql(runKey)}, ${sql(manifestFingerprint)}, 'authenticated_browser_capture', ${sql(fixture.sourceLabel)}, 'completed', NULL, ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}, NULL, NULL, 'Verified status-only schedule refresh; no dates, dependencies, access, notifications, external links, or Sage writes.', ${sql(summary)}, ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}) ON CONFLICT(organization_id, run_key) DO UPDATE SET status='completed', completed_at=excluded.completed_at, summary_json=excluded.summary_json, updated_at=excluded.updated_at WHERE buildertrend_staging_runs.manifest_fingerprint=excluded.manifest_fingerprint;`,
  ]

  const payloadForItem = (item) => JSON.stringify({
    buildertrendJobId: fixture.buildertrendJobId,
    buildertrendRecordId: item.sourceRecordId,
    status: sourceStatus(item.percent),
    percentComplete: item.percent,
    capturedAt: fixture.capturedAt,
    statusOnly: true,
  })
  const statusCaseSql = caseBySourceRecordId(fixture.items, (item) => item.status)
  const percentCaseSql = caseBySourceRecordId(fixture.items, (item) => item.percent)
  const recordStatusCaseSql = caseBySourceRecordId(
    fixture.items,
    (item) => sourceStatus(item.percent),
  )
  const sourceStatusCaseSql = caseBySourceRecordId(
    fixture.items,
    (item) => `${item.percent}%`,
  )
  const summaryCaseSql = caseBySourceRecordId(
    fixture.items,
    (item) => `${item.title}; ${item.percent}%`,
  )
  const payloadCaseSql = caseBySourceRecordId(fixture.items, payloadForItem)

  statements.push(
    `UPDATE schedule_tasks AS task SET status=${statusCaseSql}, percent_complete=${percentCaseSql}, updated_at=${sql(fixture.capturedAt)} FROM buildertrend_staging_records AS source WHERE task.project_id=${sql(fixture.projectId)} AND task.id=source.promoted_record_id AND ${promotedScopeSql} AND source.buildertrend_record_id IN (${sourceRecordIdsSql});`,
    // Match immutable source identity rather than source_key: early staged
    // schedule records intentionally retain their legacy source keys.
    `UPDATE buildertrend_staging_records AS source SET buildertrend_url=NULL, record_status=${recordStatusCaseSql}, source_status=${sourceStatusCaseSql}, normalized_summary=${summaryCaseSql}, raw_payload_json=${payloadCaseSql}, updated_at=${sql(fixture.capturedAt)} WHERE ${promotedScopeSql} AND source.buildertrend_record_id IN (${sourceRecordIdsSql});`,
    `INSERT OR IGNORE INTO buildertrend_staging_observations (id, import_run_id, organization_id, entity_kind, entity_key, entity_id, observed_payload_json, observed_at) SELECT ${sql(`bt-status-observation-${captureDate}-${captureFingerprint}-${fixture.buildertrendJobId}-`)} || source.buildertrend_record_id, ${sql(runId)}, ${sql(fixture.organizationId)}, 'record', ${sql(`job:${fixture.buildertrendJobId}:schedule_item:`)} || source.buildertrend_record_id, source.id, ${payloadCaseSql}, ${sql(fixture.capturedAt)} FROM buildertrend_staging_records AS source WHERE ${promotedScopeSql} AND source.buildertrend_record_id IN (${sourceRecordIdsSql});`,
  )

  statements.push(
    `SELECT ${sql(fixture.projectId)} AS project_id, ${fixture.items.length} AS refreshed_source_items, (SELECT COUNT(*) FROM schedule_tasks WHERE project_id=${sql(fixture.projectId)} AND status='COMPLETE') AS complete_items, (SELECT COUNT(*) FROM schedule_tasks WHERE project_id=${sql(fixture.projectId)} AND status='IN_PROGRESS') AS in_progress_items, (SELECT COUNT(*) FROM schedule_tasks WHERE project_id=${sql(fixture.projectId)} AND status='PENDING') AS pending_items;`,
  )
  return `${statements.join("\n")}\n`
}

export function summarizeBuildertrendScheduleStatusRefresh(input) {
  const fixture = validateFixture(input)
  return {
    projectId: fixture.projectId,
    projectNumber: fixture.projectNumber,
    buildertrendJobId: fixture.buildertrendJobId,
    capturedAt: fixture.capturedAt,
    sourceItemCount: fixture.items.length,
    expectedCompassTaskCount: fixture.expectedCompassTaskCount,
    completeItems: fixture.items.filter((item) => item.status === "COMPLETE").length,
    inProgressItems: fixture.items.filter((item) => item.status === "IN_PROGRESS").length,
    pendingItems: fixture.items.filter((item) => item.status === "PENDING").length,
    createsExternalLinks: false,
  }
}
