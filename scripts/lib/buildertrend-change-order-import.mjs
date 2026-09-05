const PROJECT_IDS = new Set([
  "proj-o-170-loomis",
  "proj-o-202-loeffler",
])

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

function statusMapping(buildertrendStatus) {
  if (buildertrendStatus === "Approved") {
    return { compassStatus: "executed", audience: "owner" }
  }
  if (buildertrendStatus === "Draft") {
    return { compassStatus: "draft", audience: "internal" }
  }
  throw new Error(`Unsupported Buildertrend status: ${buildertrendStatus}`)
}

function validateFixture(fixture) {
  requiredString(fixture.capturedAt, "capturedAt")
  if (!Array.isArray(fixture.projects) || fixture.projects.length !== 2) {
    throw new Error("Import must contain exactly Loomis and Loeffler")
  }

  const seenProjects = new Set()
  const seenRecords = new Set()
  const seenNumbers = new Set()
  for (const project of fixture.projects) {
    const projectId = requiredString(project.projectId, "projectId")
    if (!PROJECT_IDS.has(projectId) || seenProjects.has(projectId)) {
      throw new Error(`Unexpected or duplicate project: ${projectId}`)
    }
    seenProjects.add(projectId)
    requiredString(project.buildertrendProjectId, "buildertrendProjectId")
    requiredString(project.requesterName, "requesterName")
    if (!Array.isArray(project.orders)) throw new Error("orders must be an array")

    for (const order of project.orders) {
      const recordId = requiredString(order.recordId, "recordId")
      const number = requiredString(order.number, "number")
      const recordKey = `${projectId}:${recordId}`
      const numberKey = `${projectId}:${number}`
      if (seenRecords.has(recordKey) || seenNumbers.has(numberKey)) {
        throw new Error(`Duplicate Buildertrend change order: ${recordKey}`)
      }
      seenRecords.add(recordKey)
      seenNumbers.add(numberKey)
      requiredString(order.title, "title")
      requiredString(order.createdAt, "createdAt")
      requiredString(order.statusDate, "statusDate")
      statusMapping(requiredString(order.status, "status"))
      if (!Number.isSafeInteger(order.amountCents)) {
        throw new Error(`Invalid amount for ${number}`)
      }
      if (!Number.isSafeInteger(order.documentCount) || order.documentCount < 0) {
        throw new Error(`Invalid document count for ${number}`)
      }
    }
  }
}

function insertChangeOrder(project, order, capturedAt) {
  const mapping = statusMapping(order.status)
  const id = `bt-co-${project.buildertrendProjectId}-${order.recordId}`
  const sourceHref = `https://buildertrend.net/app/ChangeOrders/${order.recordId}/${project.buildertrendProjectId}/Details`
  const submittedAt = mapping.compassStatus === "draft" ? null : order.createdAt
  const note = [
    `Imported from Buildertrend on ${capturedAt.slice(0, 10)}.`,
    `Buildertrend status: ${order.status} (${order.statusDate}).`,
    `${order.documentCount} Buildertrend supporting document${order.documentCount === 1 ? "" : "s"} recorded; files are not exposed as legacy source links.`,
  ].join(" ")
  const metadata = JSON.stringify({
    buildertrendProjectId: project.buildertrendProjectId,
    buildertrendRecordId: order.recordId,
    buildertrendStatus: order.status,
    buildertrendStatusDate: order.statusDate,
    buildertrendDocumentCount: order.documentCount,
    initiatorProvenance: {
      status: "unknown",
      reason: "Buildertrend capture did not include independent initiator evidence",
    },
    projectAssociation: {
      name: project.requesterName,
      scope: "project_level_import_association",
      sourceVerifiedForChangeOrder: false,
    },
  })
  const historyAt = `${order.statusDate}T18:00:00.000Z`

  return [
    `INSERT INTO project_change_orders (id, project_id, change_order_number, title, scope, reason, amount_cents, schedule_impact_days, status, audience, requester_type, requester_user_id, requester_name, requester_company, source_type, source_record_id, source_href, internal_notes, foxit_status, sage_status, created_by, submitted_at, created_at, updated_at) SELECT ${sql(id)}, ${sql(project.projectId)}, ${sql(order.number)}, ${sql(order.title)}, ${sql(order.title)}, NULL, ${sql(order.amountCents)}, NULL, ${sql(mapping.compassStatus)}, ${sql(mapping.audience)}, 'unknown', NULL, 'Initiator not verified from Buildertrend', NULL, 'buildertrend_import', ${sql(order.recordId)}, ${sql(sourceHref)}, ${sql(note)}, 'not_started', 'not_ready', NULL, ${sql(submittedAt)}, ${sql(order.createdAt)}, ${sql(capturedAt)} WHERE EXISTS (SELECT 1 FROM projects WHERE id = ${sql(project.projectId)} AND buildertrend_project_id = ${sql(project.buildertrendProjectId)}) ON CONFLICT(project_id, change_order_number) DO NOTHING;`,
    `INSERT OR IGNORE INTO project_change_order_lines (id, project_id, change_order_id, line_number, description, phase_code, cost_code, amount_cents, created_at, updated_at) SELECT ${sql(`${id}-line-1`)}, ${sql(project.projectId)}, ${sql(id)}, 1, ${sql(order.title)}, NULL, NULL, ${sql(order.amountCents)}, ${sql(order.createdAt)}, ${sql(capturedAt)} WHERE EXISTS (SELECT 1 FROM project_change_orders WHERE id = ${sql(id)});`,
    `INSERT OR IGNORE INTO project_change_order_history (id, project_id, change_order_id, event_type, from_status, to_status, actor_user_id, actor_name, actor_role, note, metadata_json, created_at) SELECT ${sql(`${id}-import`)}, ${sql(project.projectId)}, ${sql(id)}, 'buildertrend_import', NULL, ${sql(mapping.compassStatus)}, NULL, 'Buildertrend import', 'system', ${sql(note)}, ${sql(metadata)}, ${sql(historyAt)} WHERE EXISTS (SELECT 1 FROM project_change_orders WHERE id = ${sql(id)});`,
  ].join("\n")
}

export function generateBuildertrendChangeOrderImportSql(fixture) {
  validateFixture(fixture)
  // Wrangler's remote D1 executor rejects SQL BEGIN/COMMIT statements. Each
  // statement is conflict-safe so an interrupted import can be rerun safely.
  const statements = []
  for (const project of fixture.projects) {
    for (const order of project.orders) {
      statements.push(insertChangeOrder(project, order, fixture.capturedAt))
    }
  }
  return `${statements.join("\n")}\n`
}
