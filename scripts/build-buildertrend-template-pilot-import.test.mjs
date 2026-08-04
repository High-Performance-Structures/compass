import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

test("builds an idempotent category-only six-template pilot without verifying the remaining 34", async () => {
  const directory = await mkdtemp(join(tmpdir(), "compass-template-pilot-"))
  const inventoryOutput = join(directory, "inventory.sql")
  const output = join(directory, "pilot.sql")
  const inventoryResult = await execFileAsync("bun", [
    "scripts/build-buildertrend-template-inventory-sql.mjs",
    "--input", "scripts/fixtures/buildertrend-active-template-inventory-2026-07-31.json",
    "--organization-id", "org-test",
    "--output", inventoryOutput,
  ])
  assert.deepEqual(JSON.parse(inventoryResult.stdout), {
    dryRun: false,
    importedCount: 40,
    excludedArchivedCount: 27,
    output: inventoryOutput,
  })
  const result = await execFileAsync("bun", [
    "scripts/build-buildertrend-template-capture-sql.mjs",
    "--inventory", "scripts/fixtures/buildertrend-active-template-inventory-2026-07-31.json",
    "--capture", "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
    "--pilot-manifest", "scripts/fixtures/buildertrend-template-pilot-2026-08-03.json",
    "--organization-id", "org-test",
    "--output", output,
  ])

  assert.deepEqual(JSON.parse(result.stdout), {
    dryRun: false,
    capturedTemplateCount: 6,
    capturedScheduleCount: 6,
    capturedScheduleItemCount: 70,
    publishCapturedSchedules: false,
    pilotTemplateCount: 6,
    remainingActiveTemplatesUnverified: 34,
    excludedArchivedCount: 27,
    output,
  })
  const sql = await readFile(output, "utf8")
  assert.match(sql, /department_code, trade_category/)
  assert.match(sql, /NULL, 'Drywall'/)
  assert.match(sql, /NULL, 'Preconstruction'/)
  assert.doesNotMatch(sql, /'ORC'/)
  assert.doesNotMatch(sql, /template:concrete-footer-assembly/)
  assert.match(sql, /ON CONFLICT\(organization_id, source_system, source_key\) DO UPDATE/)
  const inventorySql = await readFile(inventoryOutput, "utf8")
  assert.equal(
    (inventorySql.match(/INSERT INTO project_templates/g) ?? []).length,
    40
  )
  assert.equal(40 - 6, 34)
  await rm(directory, { recursive: true, force: true })
})

test("rejects a truncated source capture before applying the six-template allowlist", async () => {
  const inventory = JSON.parse(
    await readFile("scripts/fixtures/buildertrend-active-template-inventory-2026-07-31.json", "utf8")
  )
  const capture = JSON.parse(
    await readFile("scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json", "utf8")
  )
  const manifest = JSON.parse(
    await readFile("scripts/fixtures/buildertrend-template-pilot-2026-08-03.json", "utf8")
  )
  inventory.templates = inventory.templates.slice(0, 6)
  capture.templates = capture.templates.slice(0, 6)
  const { buildBuildertrendTemplatePilot } = await import("./lib/buildertrend-template-pilot.mjs")
  assert.throws(
    () => buildBuildertrendTemplatePilot({ inventory, capture, manifest }),
    /must contain all 40 active templates/
  )
})
