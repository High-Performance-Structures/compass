import { createHash } from "node:crypto"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const HEADING = /^\s*([A-Z][a-z]{2} \d{1,2}, \d{4})\s*$/
const FIELD = /^\s*(Job|Title|Added By|Log Notes|Tags|Weather Conditions|Attachments):[ \t]*(.*)$/
const QUALIFICATION = "Preserved printed export only. Original numeric Buildertrend log IDs, whole-history coverage, original attachment bytes, complete comments/audiences and project completion are not certified."
// D1 limits each statement to 100,000 bytes; retain room for framing and diagnostics.
const MAX_STATEMENT_BYTES = 90_000
const LOG_COLUMNS = ["id", "project_id", "author_id", "source_system", "source_external_id", "log_date", "weather_temp_f", "weather_conditions", "weather_precipitation", "weather_source", "work_completed", "issues", "materials_used", "crew_present", "hours_worked", "safety_incidents", "visitor_log", "notes", "is_client_visible", "review_status", "tags", "sync_status", "created_at", "updated_at"]
const DOC_COLUMNS = ["id", "project_id", "category", "title", "description", "document_date", "revision", "status", "audience", "downloadable", "visible_to_owner", "visible_to_sub_vendor", "source_drive_file_id", "source_file_name", "source_mime_type", "source_url", "source_checksum", "supersedes_document_id", "published_by", "published_at", "archived_at", "created_by", "created_at", "updated_at"]

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`)
  return value
}

function clean(value) {
  return value.split("\n").map((line) => line.trim().replace(/[ \t]+/g, " ")).join("\n").trim()
}

function date(label) {
  const match = label.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/)
  if (!match) throw new Error(`Invalid printed heading date: ${label}`)
  const month = MONTHS.indexOf(match[1])
  const day = Number(match[2])
  const year = Number(match[3])
  const parsed = new Date(Date.UTC(year, month, day))
  if (month < 0 || year < 1900 || year > 2100 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month || parsed.getUTCDate() !== day) {
    throw new Error(`Invalid printed heading date: ${label}`)
  }
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function contentLines(layoutText) {
  return layoutText.replaceAll("\r\n", "\n").split("\f").flatMap((page, pageIndex) => {
    let prelude = pageIndex === 0
    const lines = page.split("\n")
    return lines.filter((line, index) => {
      if (HEADING.test(line) || FIELD.test(line)) prelude = false
      if (index < 5 && /^\s*\d{1,2}\/\d{1,2}\/\d{2,4},.*Daily Log Print\s*$/.test(line)) return false
      if (prelude && /^\s*(?:Printed:|PO Box|Phone:\s*\d|Daily Logs List\s*$)/.test(line)) return false
      return !(index >= lines.length - 5 && /^\s*https?:\/\/buildertrend\.net\/app\/DailyLog\/Print.*\s\d+\s*\/\s*\d+\s*$/.test(line))
    })
  })
}

// Only standalone printed headings supply log dates. Weather timestamps never do.
// Layout text is required so headings remain in their visual reading order.
export function parseBuildertrendDailyLogPdf(layoutText) {
  required(layoutText, "pdftotext -layout text")
  const lines = contentLines(layoutText)
  const records = []
  let heading = null
  let current = null
  let field = null
  function finish() {
    if (current === null) return
    for (const key of ["Job", "Title", "Added By", "Log Notes", "Attachments"]) {
      if (!Object.hasOwn(current.fields, key)) throw new Error(`Entry ${records.length + 1} missing ${key}`)
    }
    const fields = current.fields
    const attachmentsText = clean(fields.Attachments)
    // Discussion or image labels after the count are retained in raw source text.
    const count = attachmentsText.match(/^(\d+)(?:\s|$)/)
    if (!count || !Number.isSafeInteger(Number(count[1]))) throw new Error("Invalid printed attachment count")
    const author = clean(fields["Added By"])
    if (!author) throw new Error("Printed Added By is empty; resolve the source author before import")
    const job = clean(fields.Job)
    const title = clean(fields.Title)
    if (!job) throw new Error(`Entry ${records.length + 1} has an empty printed job`)
    records.push({
      position: records.length + 1, logDate: current.logDate, printedDate: current.printedDate,
      job, title, author, notes: clean(fields["Log Notes"]),
      weather: clean(fields["Weather Conditions"] ?? ""),
      printedTags: clean(fields.Tags ?? ""), attachments: Number(count[1]),
      rawText: current.raw.join("\n"), sourceBlockSha256: sha256(current.raw.join("\n")),
    })
    current = null
    field = null
  }
  for (const line of lines) {
    const h = line.match(HEADING)
    if (h) {
      // A date inside a note is not a new record unless the prior entry ended.
      if (current !== null && !Object.hasOwn(current.fields, "Attachments")) {
        current.fields[field] += `\n${line}`
        current.raw.push(line)
        continue
      }
      finish()
      if (heading !== null) throw new Error("Multiple unassigned printed headings; layout order is ambiguous")
      heading = { printedDate: h[1], logDate: date(h[1]) }
      continue
    }
    const match = line.match(FIELD)
    if (match?.[1] === "Job") {
      finish()
      if (heading === null) throw new Error("Entry has no unambiguous printed heading date")
      current = { ...heading, fields: { Job: match[2] }, raw: [line] }
      heading = null
      field = "Job"
      continue
    }
    if (current === null) {
      if (line.trim() && heading !== null) throw new Error("Unexpected text between printed heading and Job")
      continue
    }
    current.raw.push(line)
    if (match) {
      if (Object.hasOwn(current.fields, match[1])) throw new Error(`Repeated field ${match[1]}; resolve ambiguous layout`)
      field = match[1]
      current.fields[field] = match[2]
    } else {
      current.fields[field] += `\n${line}`
    }
  }
  finish()
  if (heading !== null) throw new Error("Trailing printed heading has no entry; export may be incomplete")
  if (!records.length) throw new Error("No printed entries found")
  return records
}

function sql(value) {
  if (value === null) return "NULL"
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value !== "string") throw new Error("Snapshot values must be strings, finite numbers or null")
  return `'${value.replaceAll("'", "''")}'`
}

function predicate(row) {
  return Object.entries(row).map(([key, value]) => {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error("Invalid snapshot column")
    return `"${key}" IS ${sql(value)}`
  }).join(" AND ")
}

function snapshotRows(rows, columns, projectId, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} full baseline is required`)
  const ids = new Set()
  for (const row of rows) {
    if (row === null || typeof row !== "object" || columns.some((key) => !Object.hasOwn(row, key))) throw new Error(`${label} requires full rows`)
    if (row.project_id !== projectId || ids.has(row.id)) throw new Error(`${label} baseline identity mismatch`)
    required(row.id, `${label} id`)
    predicate(row)
    ids.add(row.id)
  }
}

function boundedStatement(statement) {
  if (Buffer.byteLength(statement, "utf8") > MAX_STATEMENT_BYTES) throw new Error("A source row exceeds the safe D1 statement size; prepare a separately reviewed import")
  return statement
}

function guard(checks) {
  const render = (group) => `SELECT CASE WHEN ${group.map((check) => `(${check})`).join(" AND ")} THEN 1 ELSE json('buildertrend_pdf_guard_failed') END;`
  const statements = []
  let group = []
  for (const check of checks) {
    const candidate = [...group, check]
    if (Buffer.byteLength(render(candidate), "utf8") > MAX_STATEMENT_BYTES && group.length) {
      statements.push(boundedStatement(render(group)))
      group = [check]
    } else {
      group = candidate
    }
    boundedStatement(render(group))
  }
  if (group.length) statements.push(boundedStatement(render(group)))
  return statements.join("\n")
}

function exactBaseline(table, rows, projectId) {
  return [
    `(SELECT count(*) FROM ${table} WHERE project_id=${sql(projectId)})=${rows.length}`,
    ...rows.map((row) => `(SELECT count(*) FROM ${table} WHERE ${predicate(row)})=1`),
  ]
}

function insert(table, row) {
  return boundedStatement(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.values(row).map(sql).join(",")});`)
}

function same(row, expected) {
  return Object.entries(expected).every(([key, value]) => row[key] === value)
}

export function buildBuildertrendDailyLogPdfPlan(input, pdfBytes, layoutText) {
  const { project, source, baseline } = input
  if (!project || !source || !baseline) throw new Error("project, source and baseline are required")
  for (const key of ["id", "name", "project_number", "google_drive_folder_id"]) required(project[key], `project.${key}`)
  const projectId = project.id
  const recordedAt = required(input.recordedAt, "recordedAt")
  if (!/^\d{4}-\d{2}-\d{2}T/.test(recordedAt) || Number.isNaN(Date.parse(recordedAt))) throw new Error("recordedAt must be an ISO timestamp")
  required(source.driveId, "source.driveId")
  required(source.fileName, "source.fileName")
  required(source.printedJobLabel, "source.printedJobLabel")
  if (!/^\d+$/.test(source.buildertrendJobId ?? "")) throw new Error("Verified numeric source job binding is required")
  if (!/^%PDF-/.test(Buffer.from(pdfBytes).subarray(0, 5).toString())) throw new Error("Source bytes are not a PDF")
  const hash = sha256(pdfBytes)
  if (hash !== source.sha256 || pdfBytes.length !== source.bytes || source.remoteBytesVerified !== true) throw new Error("PDF source byte proof mismatch")
  if (source.layoutTextSha256 !== sha256(layoutText)) throw new Error("Extracted layout text proof mismatch")
  if (!Array.isArray(source.parentIds) || !source.parentIds.includes(project.google_drive_folder_id)) throw new Error("Original PDF must be in the verified client project folder")
  const binding = baseline.buildertrendBinding
  if (!binding || binding.project_id !== projectId || binding.system !== "buildertrend" || binding.external_id !== source.buildertrendJobId) throw new Error("Current project/source job binding mismatch")
  predicate(project)
  predicate(binding)
  snapshotRows(baseline.logs, LOG_COLUMNS, projectId, "logs")
  snapshotRows(baseline.documents, DOC_COLUMNS, projectId, "documents")
  const records = parseBuildertrendDailyLogPdf(layoutText)
  if (records.some((record) => record.job !== source.printedJobLabel)) throw new Error("Printed job labels differ from the verified source scope")
  const dates = records.map((record) => record.logDate).sort()
  const plannedLogs = records.map((record) => {
    // This is a PDF snapshot position, explicitly not a numeric provider log ID.
    const identity = `pdf:${hash}:${record.position}`
    const id = `bt-pdf-${sha256(`${projectId}:${identity}`)}`
    const row = Object.fromEntries(LOG_COLUMNS.map((key) => [key, null]))
    return { ...row, id, project_id: projectId, source_system: "buildertrend_pdf",
      source_external_id: identity, log_date: record.logDate,
      weather_conditions: record.weather || null, weather_source: "buildertrend",
      work_completed: record.notes || "(no log notes recorded)",
      notes: record.attachments ? `[${record.attachments} attachment references in the preserved Buildertrend PDF; original bytes not certified]` : null,
      is_client_visible: 0, review_status: "draft", sync_status: "synced",
      tags: JSON.stringify({ labels: ["archival", "buildertrend-pdf-export", "historical"],
        buildertrendAuthor: record.author, buildertrendTitle: record.title || null,
        buildertrendPdf: { driveFileId: source.driveId, sha256: hash,
          sourceEntryPositions: [record.position], printedJobLabels: [record.job],
          printedLogDates: [record.logDate], sourceBlockSha256: [record.sourceBlockSha256],
          sourceIdentityKind: "pdf-snapshot-position", buildertrendJobId: source.buildertrendJobId,
          originalNumericLogId: null, qualification: QUALIFICATION } }),
      created_at: recordedAt, updated_at: recordedAt }
  })
  const plannedById = new Map(plannedLogs.map((row) => [row.id, row]))
  for (const row of baseline.logs) {
    if (plannedById.has(row.id) && !same(row, plannedById.get(row.id))) throw new Error("Planned native ID conflicts with an existing record")
    if (["buildertrend", "buildertrend_pdf"].includes(row.source_system)) {
      const planned = plannedById.get(row.id)
      if (!planned || !same(row, planned)) throw new Error("Existing Buildertrend history needs exact source-lineage reconciliation; no replacement or date/body dedup is allowed")
    }
  }
  const newLogs = plannedLogs.filter((row) => !baseline.logs.some((before) => before.id === row.id))
  if (newLogs.some((row) => baseline.logs.some((before) => before.source_external_id === row.source_external_id))) throw new Error("Source identity is already assigned to another row")
  const matchingDocs = baseline.documents.filter((row) => row.source_drive_file_id === source.driveId)
  if (matchingDocs.length > 1) throw new Error("Multiple source document references require reconciliation")
  let newDocument = null
  if (matchingDocs.length === 1) {
    const doc = matchingDocs[0]
    if (doc.source_checksum !== hash || doc.source_mime_type !== "application/pdf" || doc.audience !== "project_team" || doc.visible_to_owner !== 0 || doc.visible_to_sub_vendor !== 0 || doc.downloadable !== 1 || doc.status !== "current" || doc.published_at === null) throw new Error("Existing source document needs a separate exact metadata/access review")
  } else {
    newDocument = Object.fromEntries(DOC_COLUMNS.map((key) => [key, null]))
    Object.assign(newDocument, { id: `bt-pdf-doc-${sha256(`${projectId}:${source.driveId}`)}`,
      project_id: projectId, category: "other",
      title: `Buildertrend Daily Log Export — ${project.name} (${dates[0]} … ${dates.at(-1)})`,
      description: `Preserved Buildertrend daily-log print with ${records.length} printed entries. ${QUALIFICATION}${records.length === 100 ? " Exactly 100 entries are captured; reconcile the actual source count before inferring coverage." : ""}`,
      document_date: dates.at(-1), status: "current", audience: "project_team", downloadable: 1,
      visible_to_owner: 0, visible_to_sub_vendor: 0,
      source_drive_file_id: source.driveId, source_file_name: source.fileName,
      source_mime_type: "application/pdf", source_checksum: hash,
      published_at: recordedAt, created_at: recordedAt, updated_at: recordedAt })
  }
  const identityChecks = [
    `(SELECT count(*) FROM projects WHERE ${predicate(project)})=1`,
    `(SELECT count(*) FROM project_external_links WHERE ${predicate(binding)})=1`,
    `(SELECT count(*) FROM project_external_links WHERE project_id=${sql(projectId)} AND system='buildertrend')=1`,
  ]
  const applyChecks = [...identityChecks, ...exactBaseline("daily_logs", baseline.logs, projectId), ...exactBaseline("project_documents", baseline.documents, projectId)]
  const afterLogs = [...baseline.logs, ...newLogs]
  const afterDocs = newDocument ? [...baseline.documents, newDocument] : baseline.documents
  const inverseChecks = [...identityChecks, ...exactBaseline("daily_logs", afterLogs, projectId), ...exactBaseline("project_documents", afterDocs, projectId)]
  if (newLogs.length) {
    const ids = newLogs.map((row) => sql(row.id)).join(",")
    for (const table of ["daily_log_photos", "internal_duty_entries", "project_interactions", "project_todo_events", "daily_log_task_links", "project_client_meetings"]) {
      inverseChecks.push(`(SELECT count(*) FROM ${table} WHERE daily_log_id IN (${ids}))=0`)
    }
    inverseChecks.push(`(SELECT count(*) FROM owner_project_updates u JOIN json_each(CASE WHEN json_valid(u.source_daily_log_ids) THEN u.source_daily_log_ids ELSE '[]' END) j WHERE j.value IN (${ids}))=0`)
    inverseChecks.push(`(SELECT count(*) FROM owner_project_updates WHERE project_id=${sql(projectId)} AND CASE WHEN source_daily_log_ids IS NULL OR source_daily_log_ids='' THEN 0 WHEN NOT json_valid(source_daily_log_ids) THEN 1 WHEN json_type(source_daily_log_ids)<>'array' THEN 1 ELSE 0 END=1)=0`)
  }
  if (newDocument !== null) {
    // Removing an otherwise unchanged document must not sever later business references.
    inverseChecks.push(`(SELECT count(*) FROM project_estimate_basis_documents WHERE project_document_id=${sql(newDocument.id)})=0`)
    inverseChecks.push(`(SELECT count(*) FROM projects WHERE plan_set_document_id=${sql(newDocument.id)})=0`)
    inverseChecks.push(`(SELECT count(*) FROM project_documents WHERE supersedes_document_id=${sql(newDocument.id)})=0`)
  }
  return {
    summary: { sourceSha256: hash, sourceDriveId: source.driveId, printedEntries: records.length,
      newLogRows: newLogs.length, newDocumentReferences: newDocument ? 1 : 0,
      newPayloadCopies: 0, nativeProviderLogIdsClaimed: 0, possiblePrintCap: records.length === 100,
      sourceCoverageCertified: false, financialWrites: 0, audienceReleases: 0,
      idempotentNoop: newLogs.length === 0 && newDocument === null, qualification: QUALIFICATION },
    sourceRecords: records, before: baseline, newLogs, newDocument,
    applySql: ["-- Apply as one atomic D1 file after source/cloud proof and plan review.", guard(applyChecks), ...(newDocument ? [insert("project_documents", newDocument)] : []), ...newLogs.map((row) => insert("daily_logs", row))].join("\n") + "\n",
    inverseSql: ["-- Exact recovery only; guards reject subsequent edits or dependent records.", guard(inverseChecks), ...newLogs.map((row) => boundedStatement(`DELETE FROM daily_logs WHERE ${predicate(row)};`)), ...(newDocument ? [boundedStatement(`DELETE FROM project_documents WHERE ${predicate(newDocument)};`)] : [])].join("\n") + "\n",
  }
}
