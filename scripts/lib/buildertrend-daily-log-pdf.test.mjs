import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import test from "node:test"
import { buildBuildertrendDailyLogPdfPlan, parseBuildertrendDailyLogPdf, sha256 } from "./buildertrend-daily-log-pdf.mjs"

const bytes = Buffer.from("%PDF-synthetic fixture; contains no client data")
const text = `10/9/26, 10:54 AM Daily Log Print
Printed: Oct 9, 2026
Daily Logs List
          Apr 7, 2026
          Job: Example Project
          Title: Visit
          Added By: Taylor Example
          Log Notes:
          Tags:
          Weather Conditions:
          Cloudy Mon, Apr 6, 2026, 10:00 AM
          Attachments: 2
          Apr 1, 2026
https://buildertrend.net/app/DailyLog/Print?filters=example 1/2
\f10/9/26, 10:54 AM Daily Log Print
          Job: Example Project
          Title: Second visit
          Added By: Avery Example
          Log Notes:
          Source text with 'apostrophe' and Unicode — preserved.
          Apr 2, 2026
          Still part of the notes.
          Tags: Warranty
          Weather Conditions:
          Attachments: 0
`
function fixture(layoutText = text) {
  return { recordedAt: "2026-10-29T18:00:00.000Z",
    project: { id: "p", name: "Example", project_number: "O-1", google_drive_folder_id: "folder", plan_set_document_id: null },
    source: { driveId: "original", fileName: "Daily Log Print.pdf", sha256: sha256(bytes), bytes: bytes.length, layoutTextSha256: sha256(layoutText), remoteBytesVerified: true, parentIds: ["folder"], printedJobLabel: "Example Project", buildertrendJobId: "123" },
    baseline: { logs: [], documents: [], buildertrendBinding: { id: "binding", project_id: "p", system: "buildertrend", label: "Source job", external_id: "123", external_number: null, external_url: null, sync_direction: "read", sync_status: "mapped", metadata: null, last_synced_at: null, created_at: "2026-10-29T18:00:00.000Z", updated_at: "2026-10-29T18:00:00.000Z" } } }
}
function database(plan, input) {
  const db = new DatabaseSync(":memory:")
  db.limits.sqlLength = 100_000
  const create = (table, row) => db.exec(`CREATE TABLE ${table} (${Object.keys(row).map((key) => `${key} ${typeof row[key] === "number" ? "NUMERIC" : "TEXT"}${key === "id" ? " PRIMARY KEY" : ""}`).join(",")})`)
  const add = (table, row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row))
  create("projects", input.project); add("projects", input.project)
  const registryMigration = readFileSync(new URL("../../drizzle/0030_project_registry.sql", import.meta.url), "utf8")
  const registryDdl = registryMigration.match(/CREATE TABLE `project_external_links`[\s\S]*?\n\);/)
  assert.ok(registryDdl, "Use the actual registry table DDL rather than inventing its column names")
  db.exec(registryDdl[0]); add("project_external_links", input.baseline.buildertrendBinding)
  create("daily_logs", plan.newLogs[0]); create("project_documents", plan.newDocument)
  for (const row of input.baseline.logs) add("daily_logs", row)
  for (const row of input.baseline.documents) add("project_documents", row)
  for (const table of ["daily_log_photos", "internal_duty_entries", "project_interactions", "project_todo_events", "daily_log_task_links", "project_client_meetings"]) db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, daily_log_id TEXT)`)
  db.exec("CREATE TABLE owner_project_updates (id TEXT PRIMARY KEY, project_id TEXT, source_daily_log_ids TEXT)")
  db.exec("CREATE TABLE project_estimate_basis_documents (id TEXT PRIMARY KEY, project_document_id TEXT REFERENCES project_documents(id) ON DELETE SET NULL)")
  db.exec("CREATE TABLE financial_guard (balance NUMERIC); INSERT INTO financial_guard VALUES(123.45)")
  return db
}
function atomic(db, sql) {
  db.exec("BEGIN")
  try { db.exec(sql); db.exec("COMMIT") }
  catch (error) { db.exec("ROLLBACK"); throw error }
}
test("printed heading controls dates across page breaks; empty fields do not consume weather", () => {
  const records = parseBuildertrendDailyLogPdf(text)
  assert.deepEqual(records.map((row) => row.logDate), ["2026-04-07", "2026-04-01"])
  assert.equal(records[0].notes, "")
  assert.equal(records[0].printedTags, "")
  assert.match(records[0].weather, /Apr 6/)
  assert.match(records[1].notes, /Apr 2, 2026\nStill part/)
  assert.equal(records[1].weather, "")
})
test("missing/ambiguous/invalid heading dates and missing source authors fail closed", () => {
  for (const changed of [text.replace("          Apr 7, 2026\n", ""), text.replace("Apr 7, 2026", "Feb 30, 2026"), text.replace("          Apr 7, 2026", "          Apr 7, 2026\n          Apr 8, 2026"), text.replace("Taylor Example", "")]) assert.throws(() => parseBuildertrendDailyLogPdf(changed))
})
test("blank source titles stay unknown and notes retain phone/address-like lines", () => {
  const changed = text.replace("Title: Visit", "Title:").replace("Source text with", "Phone: 123-456-7890\nPO Box 123\nSource text with")
  const records = parseBuildertrendDailyLogPdf(changed)
  assert.equal(records[0].title, "")
  assert.match(records[1].notes, /Phone: 123-456-7890\nPO Box 123/)
})
test("guarded apply preserves authors as metadata, internal draft state, original Drive file and exact inverse", () => {
  const input = fixture(); const plan = buildBuildertrendDailyLogPdfPlan(input, bytes, text)
  const db = database(plan, input)
  atomic(db, plan.applySql)
  const rows = db.prepare("SELECT * FROM daily_logs ORDER BY log_date DESC").all()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].crew_present, null); assert.equal(rows[0].author_id, null)
  assert.equal(rows[0].review_status, "draft"); assert.equal(rows[0].is_client_visible, 0)
  assert.equal(rows[0].work_completed, "(no log notes recorded)")
  assert.equal(JSON.parse(rows[0].tags).buildertrendAuthor, "Taylor Example")
  assert.match(rows[0].source_external_id, /^pdf:[0-9a-f]{64}:1$/)
  const doc = db.prepare("SELECT * FROM project_documents").get()
  assert.equal(doc.source_drive_file_id, "original"); assert.ok(doc.published_at)
  assert.equal(doc.published_by, null); assert.equal(doc.visible_to_owner, 0)
  assert.doesNotMatch(doc.description, /Complete unfiltered|completed project/)
  assert.equal(db.prepare("SELECT balance FROM financial_guard").get().balance, 123.45)
  atomic(db, plan.inverseSql)
  assert.equal(db.prepare("SELECT count(*) n FROM daily_logs").get().n, 0)
  assert.equal(db.prepare("SELECT count(*) n FROM project_documents").get().n, 0)
  db.close()
})
test("changed project binding or concurrent rows reject the complete transaction", () => {
  for (const mutation of ["UPDATE project_external_links SET external_id='999'", "INSERT INTO daily_logs(id,project_id) VALUES('concurrent','p')"]) {
    const input = fixture(); const plan = buildBuildertrendDailyLogPdfPlan(input, bytes, text); const db = database(plan, input)
    db.exec(mutation); assert.throws(() => atomic(db, plan.applySql))
    assert.equal(db.prepare("SELECT count(*) n FROM project_documents").get().n, 0)
    db.close()
  }
})
test("inverse rejects subsequent staff edits and every known daily-log dependency", () => {
  for (const mutation of ["UPDATE daily_logs SET review_status='approved'", ...["daily_log_photos", "internal_duty_entries", "project_interactions", "project_todo_events", "daily_log_task_links", "project_client_meetings"].map((table) => `INSERT INTO ${table} SELECT 'later',id FROM daily_logs LIMIT 1`)]) {
    const input = fixture(); const plan = buildBuildertrendDailyLogPdfPlan(input, bytes, text); const db = database(plan, input)
    atomic(db, plan.applySql); db.exec(mutation)
    assert.throws(() => atomic(db, plan.inverseSql))
    assert.equal(db.prepare("SELECT count(*) n FROM daily_logs").get().n, 2)
    assert.equal(db.prepare("SELECT count(*) n FROM project_documents").get().n, 1)
    db.close()
  }
})
test("inverse protects owner-update source arrays and holds malformed current-project source lists", () => {
  const input = fixture(); const plan = buildBuildertrendDailyLogPdfPlan(input, bytes, text)
  for (const sourceIds of [JSON.stringify([plan.newLogs[1].id]), "{bad json", JSON.stringify({ unexpected: true })]) {
    const db = database(plan, input); atomic(db, plan.applySql)
    db.prepare("INSERT INTO owner_project_updates VALUES('owner-update','p',?)").run(sourceIds)
    assert.throws(() => atomic(db, plan.inverseSql))
    assert.equal(db.prepare("SELECT count(*) n FROM daily_logs").get().n, 2)
    assert.equal(db.prepare("SELECT source_daily_log_ids FROM owner_project_updates").get().source_daily_log_ids, sourceIds)
    db.close()
  }
})
test("inverse preserves later estimate-basis, plan-set and document-version references", () => {
  const input = fixture(); const plan = buildBuildertrendDailyLogPdfPlan(input, bytes, text)
  for (const mutation of [
    `INSERT INTO project_estimate_basis_documents VALUES('basis','${plan.newDocument.id}')`,
    `UPDATE projects SET plan_set_document_id='${plan.newDocument.id}'`,
    `INSERT INTO project_documents(id,project_id,supersedes_document_id) VALUES('later-version','another-project','${plan.newDocument.id}')`,
  ]) {
    const db = database(plan, input); atomic(db, plan.applySql); db.exec(mutation)
    assert.throws(() => atomic(db, plan.inverseSql))
    assert.equal(db.prepare("SELECT count(*) n FROM daily_logs").get().n, 2)
    assert.equal(db.prepare("SELECT count(*) n FROM project_documents WHERE id=?").get(plan.newDocument.id).n, 1)
    db.close()
  }
})
test("exact snapshot repeat is a no-op; changed re-export or legacy rows require lineage reconciliation", () => {
  const input = fixture(); const first = buildBuildertrendDailyLogPdfPlan(input, bytes, text)
  input.baseline.logs = first.newLogs; input.baseline.documents = [first.newDocument]
  const repeated = buildBuildertrendDailyLogPdfPlan(input, bytes, text)
  assert.equal(repeated.summary.idempotentNoop, true)
  assert.doesNotMatch(repeated.applySql, /INSERT|DELETE|UPDATE/)
  input.baseline.logs = [{ ...first.newLogs[0], id: "legacy", source_external_id: "old-content-hash" }]
  assert.throws(() => buildBuildertrendDailyLogPdfPlan(input, bytes, text), /lineage reconciliation/)
})
test("wrong original bytes, extracted text, Drive location, source job and printed label fail", () => {
  for (const change of [i => { i.source.sha256 = "0".repeat(64) }, i => { i.source.layoutTextSha256 = "bad" }, i => { i.source.parentIds = ["other"] }, i => { i.source.buildertrendJobId = "999" }, i => { i.source.printedJobLabel = "Other" }]) {
    const input = fixture(); change(input)
    assert.throws(() => buildBuildertrendDailyLogPdfPlan(input, bytes, text))
  }
})
test("100/181-entry Unicode plans apply and recover under the real D1 SQL length limit", () => {
  for (const count of [100, 181]) {
    const entry = `Apr 7, 2026\nJob: Example Project\nTitle: Visit\nAdded By: Taylor Example\nLog Notes:\n${"Unicode — 🔧 source text; ".repeat(40)}\nTags:\nWeather Conditions:\nCloudy\nAttachments: 0\n`
    const largeText = entry.repeat(count)
    const input = fixture(largeText); const plan = buildBuildertrendDailyLogPdfPlan(input, bytes, largeText)
    assert.equal(plan.newLogs.length, count)
    assert.ok((plan.inverseSql.match(/SELECT CASE WHEN/g) ?? []).length > 1)
    const db = database(plan, input)
    atomic(db, plan.applySql)
    assert.equal(db.prepare("SELECT count(*) n FROM daily_logs").get().n, count)
    const inverseBefore = db.prepare("SELECT work_completed FROM daily_logs WHERE id=?").get(plan.newLogs.at(-1).id).work_completed
    db.prepare("UPDATE daily_logs SET work_completed='later edit' WHERE id=?").run(plan.newLogs.at(-1).id)
    assert.throws(() => atomic(db, plan.inverseSql))
    assert.equal(db.prepare("SELECT count(*) n FROM daily_logs").get().n, count)
    db.prepare("UPDATE daily_logs SET work_completed=? WHERE id=?").run(inverseBefore, plan.newLogs.at(-1).id)
    atomic(db, plan.inverseSql)
    assert.equal(db.prepare("SELECT count(*) n FROM daily_logs").get().n, 0)
    db.close()
  }
})
test("an individually oversized Unicode source row is rejected during preparation", () => {
  const oversized = text.replace("Source text with", "🔧".repeat(30_000) + "Source text with")
  assert.throws(() => buildBuildertrendDailyLogPdfPlan(fixture(oversized), bytes, oversized), /statement size/)
})
