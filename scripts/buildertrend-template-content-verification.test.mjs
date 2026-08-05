import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"

import { assembleBuildertrendTemplateNextBatchContent } from "./lib/buildertrend-template-next-batch-content.mjs"
import {
  assertReadOnlyVerificationSql,
  buildBuildertrendTemplateContentVerificationSql,
} from "./lib/buildertrend-template-content-verification.mjs"

const execFileAsync = promisify(execFile)
const releasePath =
  "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json"

async function fixture() {
  const [release, nextBatchManifest, reviewedCapture] = await Promise.all([
    readFile(releasePath, "utf8").then(JSON.parse),
    readFile("scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json", "utf8").then(JSON.parse),
    readFile("scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json", "utf8").then(JSON.parse),
  ])
  const documents = await Promise.all(release.templates.map(async (template) => ({
    source: template.fragmentPath,
    document: JSON.parse(await readFile(template.fragmentPath, "utf8")),
  })))
  return {
    release,
    ...assembleBuildertrendTemplateNextBatchContent({
      release,
      nextBatchManifest,
      reviewedCapture,
      documents,
    }),
  }
}

function schemaSql() {
  return `
    CREATE TABLE project_templates (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, source_system TEXT NOT NULL,
      source_template_id TEXT, source_url TEXT, name TEXT NOT NULL,
      lifecycle_status TEXT NOT NULL, review_status TEXT NOT NULL,
      current_version_number INTEGER, updated_at TEXT
    );
    CREATE TABLE project_template_versions (
      id TEXT PRIMARY KEY, template_id TEXT NOT NULL, version_number INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE project_template_modules (
      id TEXT PRIMARY KEY, version_id TEXT NOT NULL, module_type TEXT NOT NULL,
      source_item_count INTEGER NOT NULL, normalization_status TEXT NOT NULL,
      source_payload_json TEXT,
      UNIQUE(version_id, module_type)
    );
    CREATE TABLE project_template_content_items (
      id TEXT PRIMARY KEY, version_id TEXT NOT NULL, module_type TEXT NOT NULL,
      source_item_id TEXT, parent_source_item_id TEXT, title TEXT NOT NULL,
      category TEXT, description TEXT, sort_order INTEGER NOT NULL, payload_json TEXT,
      UNIQUE(version_id, module_type, source_item_id)
    );
    CREATE TABLE schedule_template_items (
      id TEXT PRIMARY KEY, version_id TEXT NOT NULL, source_item_id TEXT,
      item_key TEXT NOT NULL, title TEXT NOT NULL, start_offset_workdays INTEGER NOT NULL,
      workdays INTEGER NOT NULL, phase TEXT NOT NULL, display_color TEXT NOT NULL,
      is_milestone INTEGER NOT NULL, assignee_placeholder TEXT,
      owner_visible INTEGER NOT NULL, sub_vendor_visible INTEGER NOT NULL,
      notes TEXT, sort_order INTEGER NOT NULL,
      UNIQUE(version_id, item_key)
    );
    CREATE TABLE schedule_template_dependencies (
      id TEXT PRIMARY KEY, version_id TEXT NOT NULL, predecessor_item_id TEXT NOT NULL,
      successor_item_id TEXT NOT NULL, type TEXT NOT NULL, lag_days INTEGER NOT NULL,
      UNIQUE(version_id, predecessor_item_id, successor_item_id, type)
    );
    CREATE TABLE project_template_applications (id TEXT PRIMARY KEY, version_id TEXT NOT NULL);
  `
}

function seedSql(capture, inventory) {
  const inventoryById = new Map(inventory.templates.map((template) => [template.sourceTemplateId, template]))
  const moduleTypes = [
    ["tasks", "tasks"],
    ["scheduleItems", "schedule"],
    ["selections", "selections"],
    ["bidPackages", "bid_packages"],
  ]
  const statements = []
  for (const template of capture.templates) {
    const templateId = `template-${template.sourceTemplateId}`
    const versionId = `bt-template-version:${template.sourceTemplateId}:1`
    statements.push(
      `INSERT INTO project_templates VALUES (` +
      `'${templateId}', 'org-test', 'buildertrend', '${template.sourceTemplateId}', NULL, ` +
      `'${template.name.replaceAll("'", "''")}', 'draft', 'content_captured', 1, NULL);`
    )
    statements.push(
      `INSERT INTO project_template_versions VALUES ('${versionId}', '${templateId}', 1, 'draft');`
    )
    for (const [sourceKey, moduleType] of moduleTypes) {
      const count = inventoryById.get(template.sourceTemplateId).moduleCounts[sourceKey] ?? 0
      statements.push(
        `INSERT INTO project_template_modules VALUES (` +
        `'module-${template.sourceTemplateId}-${moduleType}', '${versionId}', '${moduleType}', ` +
        `${count}, 'inventory_only', NULL);`
      )
    }
  }
  return statements.join("\n")
}

async function query(database, sql) {
  const result = await execFileAsync("sqlite3", ["-json", database, sql])
  return result.stdout.trim()
}

async function applyFile(database, path) {
  await execFileAsync("sqlite3", [database, `.read ${path}`])
}

test("generates one read-only preflight and postflight statement with exact scope", async () => {
  const { release, capture, inventory } = await fixture()
  for (const phase of ["preflight", "postflight"]) {
    const build = buildBuildertrendTemplateContentVerificationSql({
      capture,
      inventory,
      organizationId: "org-test",
      phase,
      excludedSourceTemplateIds: release.excludedTemplates.map((template) => template.sourceTemplateId),
    })
    assert.equal(assertReadOnlyVerificationSql(build.sql), true)
    assert.equal(build.verificationPart, null)
    assert.equal(build.verificationPartCount, 6)
    assert.equal(build.templateCount, 17)
    assert.equal(build.contentItemCount, 511)
    assert.equal(build.predecessorCount, 54)
    assert.equal(build.reusableScheduleItemCount, 71)
    assert.equal(build.reusableDependencyCount, 54)
    assert.deepEqual(
      build.sourceTemplateIds,
      ["12859981", "12978371", "12581937", "12594475", "30917204", "12646335", "12650792", "12819873", "12649495", "30914491", "12858966", "12649292", "12650557", "30919251", "12650484", "12650713", "28466146"]
    )
    assert.deepEqual(build.excludedSourceTemplateIds, [])
    assert.match(build.sql, /SELECT 'excluded_template_content'/)
    assert.doesNotMatch(
      build.sql.replaceAll(/'(?:''|[^'])*'/g, "''"),
      /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|ATTACH)\b/i
    )
    for (let verificationPart = 1; verificationPart <= build.verificationPartCount; verificationPart += 1) {
      const part = buildBuildertrendTemplateContentVerificationSql({
        capture,
        inventory,
        organizationId: "org-test",
        phase,
        verificationPart,
      })
      assert.equal(assertReadOnlyVerificationSql(part.sql), true)
      assert.ok((part.sql.match(/UNION ALL/g) ?? []).length <= 3)
    }
  }
})

test("CLI scopes a D1-safe verification query to one reviewed template", async () => {
  const { capture, inventory } = await fixture()
  const directory = await mkdtemp(join(tmpdir(), "compass-template-scoped-verification-"))
  const capturePath = join(directory, "capture.json")
  const inventoryPath = join(directory, "inventory.json")
  const outputPath = join(directory, "preflight.sql")
  try {
    await Promise.all([
      writeFile(capturePath, `${JSON.stringify(capture)}\n`),
      writeFile(inventoryPath, `${JSON.stringify(inventory)}\n`),
    ])
    const result = await execFileAsync("bun", [
      "scripts/build-buildertrend-template-content-verification-sql.mjs",
      "--capture", capturePath,
      "--inventory", inventoryPath,
      "--organization-id", "org-test",
      "--phase", "preflight",
      "--source-template-id", "12581937",
      "--verification-part", "1",
      "--output", outputPath,
    ])
    assert.deepEqual(JSON.parse(result.stdout), {
      phase: "preflight",
      readOnly: true,
      verificationPart: 1,
      verificationPartCount: 6,
      templateCount: 1,
      contentItemCount: 51,
      predecessorCount: 7,
      reusableScheduleItemCount: 8,
      reusableDependencyCount: 7,
      sourceTemplateIds: ["12581937"],
      excludedSourceTemplateIds: [],
      output: outputPath,
    })
    const sql = await readFile(outputPath, "utf8")
    assert.equal(assertReadOnlyVerificationSql(sql), true)
    assert.match(sql, /Concrete - Footer Assembly/)
    assert.doesNotMatch(sql, /Ext\. Finishes - Stucco|MEP - Rough & Top Out|Concrete - Slab Assembly/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("preflight passes a fresh draft and postflight remains identical across two imports", async () => {
  const { release, capture, inventory } = await fixture()
  const directory = await mkdtemp(join(tmpdir(), "compass-template-verification-"))
  const database = join(directory, "verification.sqlite")
  const capturePath = join(directory, "capture.json")
  const inventoryPath = join(directory, "inventory.json")
  const importPath = join(directory, "import.sql")
  try {
    await execFileAsync("sqlite3", [database, `${schemaSql()}\n${seedSql(capture, inventory)}`])
    const preflight = buildBuildertrendTemplateContentVerificationSql({
      capture,
      inventory,
      organizationId: "org-test",
      phase: "preflight",
      excludedSourceTemplateIds: release.excludedTemplates.map((template) => template.sourceTemplateId),
    })
    assert.equal(await query(database, preflight.sql), "")

    await Promise.all([
      writeFile(capturePath, `${JSON.stringify(capture)}\n`),
      writeFile(inventoryPath, `${JSON.stringify(inventory)}\n`),
    ])
    await execFileAsync("bun", [
      "scripts/build-buildertrend-template-next-batch-content-sql.mjs",
      "--capture", capturePath,
      "--inventory", inventoryPath,
      "--output", importPath,
    ])
    const postflight = buildBuildertrendTemplateContentVerificationSql({
      capture,
      inventory,
      organizationId: "org-test",
      phase: "postflight",
      excludedSourceTemplateIds: release.excludedTemplates.map((template) => template.sourceTemplateId),
    })
    await applyFile(database, importPath)
    assert.equal(await query(database, postflight.sql), "")
    const firstSnapshot = await query(database, `
      SELECT id, version_id, module_type, source_item_id, parent_source_item_id,
        title, category, description, sort_order, payload_json
      FROM project_template_content_items ORDER BY id;
    `)
    await applyFile(database, importPath)
    assert.equal(await query(database, postflight.sql), "")
    const secondSnapshot = await query(database, `
      SELECT id, version_id, module_type, source_item_id, parent_source_item_id,
        title, category, description, sort_order, payload_json
      FROM project_template_content_items ORDER BY id;
    `)
    assert.equal(secondSnapshot, firstSnapshot)
    await execFileAsync("sqlite3", [database, `
      UPDATE project_template_content_items
      SET payload_json=json_set(payload_json, '$.predecessors[0].type', 'SS')
      WHERE id=(SELECT id FROM project_template_content_items
        WHERE module_type='schedule'
          AND json_array_length(json_extract(payload_json, '$.predecessors')) > 0
        ORDER BY id LIMIT 1);
    `])
    const edgeIssues = JSON.parse(await query(database, postflight.sql))
    assert.equal(
      edgeIssues.some((issue) => issue.check_name === "expected_predecessor_identity"),
      true
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("verification accepts published templates while importing only the remaining draft", async () => {
  const { release, capture, inventory } = await fixture()
  const directory = await mkdtemp(join(tmpdir(), "compass-template-mixed-state-"))
  const database = join(directory, "verification.sqlite")
  const capturePath = join(directory, "capture.json")
  const inventoryPath = join(directory, "inventory.json")
  const importPath = join(directory, "import.sql")
  try {
    await execFileAsync("sqlite3", [database, `${schemaSql()}\n${seedSql(capture, inventory)}`])
    await Promise.all([
      writeFile(capturePath, `${JSON.stringify(capture)}\n`),
      writeFile(inventoryPath, `${JSON.stringify(inventory)}\n`),
    ])
    await execFileAsync("bun", [
      "scripts/build-buildertrend-template-next-batch-content-sql.mjs",
      "--capture", capturePath,
      "--inventory", inventoryPath,
      "--output", importPath,
    ])
    await applyFile(database, importPath)
    await execFileAsync("sqlite3", [database, `
      UPDATE project_templates SET lifecycle_status='active', review_status='verified'
      WHERE source_template_id IN ('12859981', '12978371');
      UPDATE project_template_versions SET status='published'
      WHERE id IN ('bt-template-version:12859981:1', 'bt-template-version:12978371:1');
      DELETE FROM schedule_template_dependencies WHERE version_id='bt-template-version:12581937:1';
      DELETE FROM schedule_template_items WHERE version_id='bt-template-version:12581937:1';
      DELETE FROM project_template_content_items WHERE version_id='bt-template-version:12581937:1';
      UPDATE project_template_modules SET normalization_status='inventory_only'
      WHERE version_id='bt-template-version:12581937:1';
      UPDATE project_templates SET review_status='inventory_only'
      WHERE source_template_id='12581937';
    `])
    const publishedBefore = await query(database, `
      SELECT id, payload_json FROM project_template_content_items
      WHERE version_id IN ('bt-template-version:12859981:1', 'bt-template-version:12978371:1')
      ORDER BY id;
    `)
    const preflight = buildBuildertrendTemplateContentVerificationSql({
      capture,
      inventory,
      organizationId: "org-test",
      phase: "preflight",
      excludedSourceTemplateIds: release.excludedTemplates.map((template) => template.sourceTemplateId),
    })
    assert.equal(await query(database, preflight.sql), "")

    await applyFile(database, importPath)
    const postflight = buildBuildertrendTemplateContentVerificationSql({
      capture,
      inventory,
      organizationId: "org-test",
      phase: "postflight",
      excludedSourceTemplateIds: release.excludedTemplates.map((template) => template.sourceTemplateId),
    })
    assert.equal(await query(database, postflight.sql), "")
    const publishedAfter = await query(database, `
      SELECT id, payload_json FROM project_template_content_items
      WHERE version_id IN ('bt-template-version:12859981:1', 'bt-template-version:12978371:1')
      ORDER BY id;
    `)
    assert.equal(publishedAfter, publishedBefore)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("postflight reports published state, partial content, and explicitly excluded content", async () => {
  const { capture, inventory } = await fixture()
  const directory = await mkdtemp(join(tmpdir(), "compass-template-verification-"))
  const database = join(directory, "verification.sqlite")
  try {
    await execFileAsync("sqlite3", [database, `${schemaSql()}\n${seedSql(capture, inventory)}`])
    await execFileAsync("sqlite3", [database, `
      UPDATE project_template_versions SET status='published'
      WHERE id='bt-template-version:12859981:1';
      INSERT INTO project_template_content_items VALUES (
        'partial', 'bt-template-version:12978371:1', 'tasks', 'partial', NULL,
        'Partial', NULL, NULL, 0, '{}'
      );
      INSERT INTO project_template_content_items VALUES (
        'stone', 'bt-template-version:37180847:1', 'tasks', 'stone', NULL,
        'Stone', NULL, NULL, 0, '{}'
      );
    `])
    const postflight = buildBuildertrendTemplateContentVerificationSql({
      capture,
      inventory,
      organizationId: "org-test",
      phase: "postflight",
      excludedSourceTemplateIds: ["37180847"],
    })
    const issues = JSON.parse(await query(database, postflight.sql))
    assert.equal(issues.some((issue) => issue.check_name === "version_state"), true)
    assert.equal(issues.some((issue) => issue.check_name === "content_total"), true)
    assert.equal(issues.some((issue) => issue.check_name === "excluded_template_content"), true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects mutation statements and invalid verification phases", async () => {
  assert.throws(
    () => assertReadOnlyVerificationSql("WITH target AS (SELECT 1) DELETE FROM target;"),
    /mutation or database-control statement/
  )
  const { capture, inventory } = await fixture()
  assert.throws(
    () => buildBuildertrendTemplateContentVerificationSql({
      capture,
      inventory,
      organizationId: "org-test",
      phase: "deploy",
    }),
    /phase must be preflight or postflight/
  )
})
