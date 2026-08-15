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

function isoDate(value, label) {
  const required = requiredString(value, label)
  const parsed = new Date(`${required} 12:00:00`)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid`)
  return parsed.toISOString().slice(0, 10)
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

function legacyDate(value) {
  const [year, month, day] = value.split("-")
  return `${Number(month)}-${Number(day)}-${year}`
}

function relationType(value) {
  const mapping = new Map([
    ["Finish-to-Start (FS)", "FS"],
    ["Start-to-Start (SS)", "SS"],
    ["Finish-to-Finish (FF)", "FF"],
    ["Start-to-Finish (SF)", "SF"],
  ])
  const mapped = mapping.get(value)
  if (!mapped) throw new Error(`Unsupported predecessor relation: ${value}`)
  return mapped
}

function validateSourceHref(value, recordId, jobId) {
  const href = requiredString(value, "sourceHref")
  const match = href.match(/^\/app\/Schedules\/\d+\/Schedule\/(\d+)\/(\d+)$/)
  if (!match || match[1] !== recordId || match[2] !== jobId) {
    throw new Error(`Unexpected Buildertrend schedule href for ${recordId}`)
  }
}

function validateFixture(fixture) {
  const organizationId = requiredString(fixture.organizationId, "organizationId")
  const projectId = requiredString(fixture.projectId, "projectId")
  const projectNumber = requiredString(fixture.projectNumber, "projectNumber")
  const buildertrendJobId = requiredString(
    fixture.buildertrendJobId,
    "buildertrendJobId",
  )
  const capturedAt = requiredString(fixture.capturedAt, "capturedAt")
  requiredString(fixture.sourceLabel, "sourceLabel")
  if (Number.isNaN(new Date(capturedAt).getTime())) {
    throw new Error("capturedAt is invalid")
  }
  if (!Array.isArray(fixture.items) || fixture.items.length === 0) {
    throw new Error("items must be a non-empty array")
  }
  if (fixture.replaceAllDependencies !== true) {
    throw new Error("replaceAllDependencies must be explicitly true")
  }

  const recordIds = new Set()
  const taskIds = new Set()
  const sortOrders = new Set()
  const itemKeys = new Map()
  const normalizedItems = fixture.items.map((item) => {
    const sourceRecordId = requiredString(item.sourceRecordId, "sourceRecordId")
    const compassTaskId = requiredString(item.compassTaskId, "compassTaskId")
    const title = requiredString(item.title, "title")
    const phase = requiredString(item.phase, "phase")
    if (!/^\d+$/.test(sourceRecordId)) {
      throw new Error(`Invalid sourceRecordId: ${sourceRecordId}`)
    }
    validateSourceHref(item.sourceHref, sourceRecordId, buildertrendJobId)
    if (recordIds.has(sourceRecordId)) {
      throw new Error(`Duplicate sourceRecordId: ${sourceRecordId}`)
    }
    recordIds.add(sourceRecordId)
    if (taskIds.has(compassTaskId)) {
      throw new Error(`Duplicate compassTaskId: ${compassTaskId}`)
    }
    taskIds.add(compassTaskId)
    if (!Number.isSafeInteger(item.sortOrder) || item.sortOrder <= 0) {
      throw new Error(`Invalid sortOrder for ${sourceRecordId}`)
    }
    if (sortOrders.has(item.sortOrder)) {
      throw new Error(`Duplicate sortOrder: ${item.sortOrder}`)
    }
    sortOrders.add(item.sortOrder)
    if (!Number.isSafeInteger(item.duration) || item.duration <= 0) {
      throw new Error(`Invalid duration for ${sourceRecordId}`)
    }
    if (!Number.isSafeInteger(item.percent) || item.percent < 0 || item.percent > 100) {
      throw new Error(`Invalid percent for ${sourceRecordId}`)
    }
    const startDate = isoDate(item.start, `start for ${sourceRecordId}`)
    const endDate = isoDate(item.end, `end for ${sourceRecordId}`)
    if (endDate < startDate) throw new Error(`End precedes start for ${sourceRecordId}`)
    const complete = item.complete === true
    const percent = complete ? 100 : item.percent
    const normalized = {
      sourceRecordId,
      compassTaskId,
      title,
      phase,
      sortOrder: item.sortOrder,
      startDate,
      endDate,
      duration: item.duration,
      percent,
      complete,
      predecessors: Array.isArray(item.predecessors) ? item.predecessors : [],
    }
    const itemKey = `${title}|${legacyDate(startDate)}|${legacyDate(endDate)}`
    if (itemKeys.has(itemKey)) throw new Error(`Duplicate schedule identity: ${itemKey}`)
    itemKeys.set(itemKey, normalized)
    return normalized
  })

  const dependencies = []
  const dependencyKeys = new Set()
  for (const successor of normalizedItems) {
    for (const predecessor of successor.predecessors) {
      // Buildertrend may render one untouched predecessor row with its default
      // FS/zero values. It is a form placeholder, not an actual dependency.
      if (
        predecessor.title === "" &&
        predecessor.relation === "Finish-to-Start (FS)" &&
        predecessor.lag === 0
      ) {
        continue
      }
      const reference = requiredString(predecessor.title, "predecessor title")
      const match = reference.match(/^(.*) - (\d{1,2}-\d{1,2}-\d{4}) to (\d{1,2}-\d{1,2}-\d{4})$/)
      if (!match) throw new Error(`Cannot parse predecessor: ${reference}`)
      const predecessorItem = itemKeys.get(`${match[1]}|${match[2]}|${match[3]}`)
      if (!predecessorItem) throw new Error(`Unknown predecessor: ${reference}`)
      const type = relationType(requiredString(predecessor.relation, "relation"))
      if (!Number.isSafeInteger(predecessor.lag)) {
        throw new Error(`Invalid lag for ${reference}`)
      }
      const key = `${predecessorItem.sourceRecordId}:${successor.sourceRecordId}`
      if (dependencyKeys.has(key)) throw new Error(`Duplicate dependency: ${key}`)
      dependencyKeys.add(key)
      dependencies.push({
        predecessorRecordId: predecessorItem.sourceRecordId,
        successorRecordId: successor.sourceRecordId,
        type,
        lagDays: predecessor.lag,
      })
    }
  }

  const edges = new Map(normalizedItems.map((item) => [item.sourceRecordId, []]))
  for (const dependency of dependencies) {
    edges.get(dependency.predecessorRecordId).push(dependency.successorRecordId)
  }
  const visiting = new Set()
  const visited = new Set()
  function visit(id) {
    if (visiting.has(id)) throw new Error("Schedule dependencies contain a cycle")
    if (visited.has(id)) return
    visiting.add(id)
    for (const successorId of edges.get(id)) visit(successorId)
    visiting.delete(id)
    visited.add(id)
  }
  for (const item of normalizedItems) visit(item.sourceRecordId)

  return {
    ...fixture,
    organizationId,
    projectId,
    projectNumber,
    buildertrendJobId,
    capturedAt,
    items: normalizedItems,
    dependencies,
  }
}

export function generateBuildertrendScheduleRefreshSql(input) {
  const fixture = validateFixture(input)
  const captureDate = fixture.capturedAt.slice(0, 10).replaceAll("-", "")
  const manifestFingerprint = fingerprint({
    projectId: fixture.projectId,
    buildertrendJobId: fixture.buildertrendJobId,
    capturedAt: fixture.capturedAt,
    items: fixture.items,
    dependencies: fixture.dependencies,
  })
  const captureFingerprint = manifestFingerprint.slice(0, 12)
  const runId = `bt-schedule-refresh-${fixture.buildertrendJobId}-${captureDate}-${captureFingerprint}`
  const runKey = `schedule-refresh:${fixture.buildertrendJobId}:${captureDate}:${captureFingerprint}`
  const summary = JSON.stringify({
    projectId: fixture.projectId,
    projectNumber: fixture.projectNumber,
    buildertrendJobId: fixture.buildertrendJobId,
    itemCount: fixture.items.length,
    dependencyCount: fixture.dependencies.length,
    preservesCompassTaskIds: true,
    createsExternalLinks: false,
  })
  const taskIdsSql = fixture.items.map((item) => sql(item.compassTaskId)).join(", ")
  const scheduleIdentitySql = fixture.items
    .map(
      (item) =>
        `(id=${sql(item.compassTaskId)} AND title=${sql(item.title)})`,
    )
    .join(" OR ")
  const guardSql = [
    `(SELECT COUNT(*) FROM projects WHERE id=${sql(fixture.projectId)} AND organization_id=${sql(fixture.organizationId)} AND project_number=${sql(fixture.projectNumber)} AND (buildertrend_project_id IS NULL OR buildertrend_project_id=${sql(fixture.buildertrendJobId)}))=1`,
    `(SELECT COUNT(*) FROM projects WHERE buildertrend_project_id=${sql(fixture.buildertrendJobId)} AND id<>${sql(fixture.projectId)})=0`,
    `(SELECT COUNT(*) FROM schedule_tasks WHERE project_id=${sql(fixture.projectId)})=${fixture.items.length}`,
    `(SELECT COUNT(*) FROM schedule_tasks WHERE project_id=${sql(fixture.projectId)} AND (${scheduleIdentitySql}))=${fixture.items.length}`,
  ].join(" AND ")

  const statements = [
    // A failed guard attempts to duplicate the project's primary key and aborts
    // before any mutation. A passing guard inserts zero rows.
    `INSERT INTO projects SELECT * FROM projects WHERE id=(SELECT id FROM projects ORDER BY id LIMIT 1) AND NOT (${guardSql});`,
    `UPDATE projects SET buildertrend_project_id=${sql(fixture.buildertrendJobId)}, updated_at=${sql(fixture.capturedAt)} WHERE id=${sql(fixture.projectId)} AND (buildertrend_project_id IS NULL OR buildertrend_project_id=${sql(fixture.buildertrendJobId)});`,
    `INSERT INTO buildertrend_staging_runs (id, organization_id, run_key, manifest_fingerprint, source_method, source_label, status, started_by, started_at, completed_at, raw_artifact_drive_file_id, raw_artifact_drive_url, source_notes, summary_json, created_at, updated_at) VALUES (${sql(runId)}, ${sql(fixture.organizationId)}, ${sql(runKey)}, ${sql(manifestFingerprint)}, 'authenticated_browser_capture', ${sql(fixture.sourceLabel)}, 'completed', NULL, ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}, NULL, NULL, 'Verified schedule refresh; no access grants, notifications, external links, or Sage writes.', ${sql(summary)}, ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}) ON CONFLICT(organization_id, run_key) DO UPDATE SET status='completed', completed_at=excluded.completed_at, summary_json=excluded.summary_json, updated_at=excluded.updated_at WHERE buildertrend_staging_runs.manifest_fingerprint=excluded.manifest_fingerprint;`,
  ]

  for (const item of fixture.items) {
    statements.push(
      `UPDATE schedule_tasks SET title=${sql(item.title)}, start_date=${sql(item.startDate)}, workdays=${sql(item.duration)}, end_date_calculated=${sql(item.endDate)}, phase=${sql(item.phase)}, status=${sql(item.complete ? "COMPLETE" : item.percent > 0 ? "IN_PROGRESS" : "PENDING")}, percent_complete=${sql(item.percent)}, sort_order=${sql(item.sortOrder)}, updated_at=${sql(fixture.capturedAt)} WHERE project_id=${sql(fixture.projectId)} AND id=${sql(item.compassTaskId)};`,
    )
  }
  statements.push(
    `DELETE FROM task_dependencies WHERE predecessor_id IN (${taskIdsSql}) AND successor_id IN (${taskIdsSql});`,
  )

  for (const item of fixture.items) {
    const recordId = `bt-staging-schedule-${fixture.buildertrendJobId}-${item.sourceRecordId}`
    const sourceKey = `job:${fixture.buildertrendJobId}:schedule_item:${item.sourceRecordId}`
    const recordPayload = JSON.stringify({
      buildertrendJobId: fixture.buildertrendJobId,
      buildertrendRecordId: item.sourceRecordId,
      startDate: item.startDate,
      endDate: item.endDate,
      workdays: item.duration,
      phase: item.phase,
      status: item.complete ? "complete" : item.percent > 0 ? "in_progress" : "pending",
      percentComplete: item.percent,
      capturedAt: fixture.capturedAt,
    })
    statements.push(
      `INSERT INTO buildertrend_staging_records (id, organization_id, source_key, requested_project_id, project_id, source_scope, source_record_type, buildertrend_job_id, buildertrend_lead_id, buildertrend_record_id, buildertrend_record_number, buildertrend_url, title, record_date, record_status, source_status, department_code, client_name, contact_name, contact_email, amount, searchable_text, normalized_summary, raw_payload_json, source_archive_drive_folder_id, source_archive_drive_file_id, source_archive_drive_url, verified_archive_drive_folder_id, verified_archive_drive_file_id, verified_archive_drive_url, review_status, promotion_status, promoted_record_type, promoted_record_id, sage_reconciliation_status, source_notes, review_notes, created_at, updated_at) VALUES (${sql(recordId)}, ${sql(fixture.organizationId)}, ${sql(sourceKey)}, ${sql(fixture.projectId)}, ${sql(fixture.projectId)}, 'job', 'schedule_item', ${sql(fixture.buildertrendJobId)}, NULL, ${sql(item.sourceRecordId)}, ${sql(String(item.sortOrder))}, NULL, ${sql(item.title)}, ${sql(item.startDate)}, ${sql(item.complete ? "complete" : item.percent > 0 ? "in_progress" : "pending")}, ${sql(`${item.percent}%`)}, ${sql(fixture.projectNumber.split("-")[0])}, NULL, NULL, NULL, NULL, ${sql(`${item.title} ${item.phase}`)}, ${sql(`${item.title}; ${item.startDate} to ${item.endDate}; ${item.percent}%`)}, ${sql(recordPayload)}, NULL, NULL, NULL, NULL, NULL, NULL, 'verified', 'promoted', 'schedule_task', ${sql(item.compassTaskId)}, 'not_reviewed', 'Authenticated Buildertrend schedule detail capture.', 'Operational task ID retained during verified refresh.', ${sql(fixture.capturedAt)}, ${sql(fixture.capturedAt)}) ON CONFLICT(organization_id, source_key) DO UPDATE SET project_id=excluded.project_id, buildertrend_record_number=excluded.buildertrend_record_number, title=excluded.title, record_date=excluded.record_date, record_status=excluded.record_status, source_status=excluded.source_status, searchable_text=excluded.searchable_text, normalized_summary=excluded.normalized_summary, raw_payload_json=excluded.raw_payload_json, promotion_status=CASE WHEN buildertrend_staging_records.promoted_record_id IS NULL OR buildertrend_staging_records.promoted_record_id=excluded.promoted_record_id THEN 'promoted' ELSE buildertrend_staging_records.promotion_status END, promoted_record_type=CASE WHEN buildertrend_staging_records.promoted_record_id IS NULL OR buildertrend_staging_records.promoted_record_id=excluded.promoted_record_id THEN 'schedule_task' ELSE buildertrend_staging_records.promoted_record_type END, promoted_record_id=CASE WHEN buildertrend_staging_records.promoted_record_id IS NULL OR buildertrend_staging_records.promoted_record_id=excluded.promoted_record_id THEN excluded.promoted_record_id ELSE buildertrend_staging_records.promoted_record_id END, updated_at=excluded.updated_at;`,
      `INSERT OR IGNORE INTO buildertrend_staging_observations (id, import_run_id, organization_id, entity_kind, entity_key, entity_id, observed_payload_json, observed_at) VALUES (${sql(`bt-observation-${captureDate}-${captureFingerprint}-${fixture.buildertrendJobId}-${item.sourceRecordId}`)}, ${sql(runId)}, ${sql(fixture.organizationId)}, 'record', ${sql(sourceKey)}, ${sql(recordId)}, ${sql(recordPayload)}, ${sql(fixture.capturedAt)});`,
    )
  }

  for (const dependency of fixture.dependencies) {
    const predecessor = fixture.items.find(
      (item) => item.sourceRecordId === dependency.predecessorRecordId,
    )
    const successor = fixture.items.find(
      (item) => item.sourceRecordId === dependency.successorRecordId,
    )
    statements.push(
      `INSERT INTO task_dependencies (id, predecessor_id, successor_id, type, lag_days) VALUES (${sql(`bt-dep-${fixture.buildertrendJobId}-${dependency.predecessorRecordId}-${dependency.successorRecordId}`)}, ${sql(predecessor.compassTaskId)}, ${sql(successor.compassTaskId)}, ${sql(dependency.type)}, ${sql(dependency.lagDays)});`,
    )
  }

  statements.push(
    `SELECT ${sql(fixture.projectId)} AS project_id, ${fixture.items.length} AS expected_items, (SELECT COUNT(*) FROM schedule_tasks WHERE project_id=${sql(fixture.projectId)}) AS operational_items, (SELECT COUNT(*) FROM task_dependencies WHERE predecessor_id IN (${taskIdsSql}) AND successor_id IN (${taskIdsSql})) AS dependencies, (SELECT COUNT(*) FROM buildertrend_staging_records WHERE organization_id=${sql(fixture.organizationId)} AND buildertrend_job_id=${sql(fixture.buildertrendJobId)} AND source_record_type='schedule_item' AND promotion_status='promoted') AS promoted_source_records;`,
  )

  return `${statements.join("\n")}\n`
}

export function summarizeBuildertrendScheduleRefresh(input) {
  const fixture = validateFixture(input)
  return {
    projectId: fixture.projectId,
    projectNumber: fixture.projectNumber,
    buildertrendJobId: fixture.buildertrendJobId,
    capturedAt: fixture.capturedAt,
    itemCount: fixture.items.length,
    dependencyCount: fixture.dependencies.length,
    preservesCompassTaskIds: true,
    createsExternalLinks: false,
  }
}
