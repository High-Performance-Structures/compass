import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const inventoryPath =
  "scripts/fixtures/buildertrend-active-template-inventory-2026-07-31.json"
const capturePath =
  "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json"
const workplanPath =
  "scripts/fixtures/buildertrend-template-capture-workplan-2026-08-03.json"
const pilotManifestPath =
  "scripts/fixtures/buildertrend-template-pilot-2026-08-03.json"
const scheduleManifestPath =
  "scripts/fixtures/buildertrend-template-nonpilot-schedules-2026-08-04.json"

function command(output, extra = []) {
  return [
    "scripts/build-buildertrend-template-capture-sql.mjs",
    "--inventory",
    inventoryPath,
    "--capture",
    capturePath,
    "--pilot-manifest",
    pilotManifestPath,
    "--schedule-scope-manifest",
    scheduleManifestPath,
    "--workplan",
    workplanPath,
    "--organization-id",
    "org-test",
    "--output",
    output,
    ...extra,
  ]
}

test("audits and builds the 34-template non-pilot schedule scope as draft-only content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "compass-nonpilot-schedules-"))
  const output = join(directory, "nonpilot-schedules.sql")
  try {
    const result = await execFileAsync("bun", command(output))
    assert.deepEqual(JSON.parse(result.stdout), {
      dryRun: false,
      capturedTemplateCount: 34,
      capturedScheduleCount: 24,
      capturedScheduleItemCount: 93,
      publishCapturedSchedules: false,
      nonPilotTemplateCount: 34,
      scheduleBearingTemplateCount: 24,
      scheduleItemCount: 93,
      scheduleDependencyCount: 70,
      gatedModuleTypes: ["tasks", "selections", "bid_packages"],
      excludedArchivedCount: 27,
      output,
    })
    const sql = await readFile(output, "utf8")
    assert.equal((sql.match(/INSERT INTO schedule_template_items/g) ?? []).length, 93)
    assert.equal(
      (sql.match(/INSERT INTO schedule_template_dependencies/g) ?? []).length,
      70
    )
    assert.match(sql, /bt-template-version:12581937:1/)
    assert.doesNotMatch(sql, /bt-template-version:30294726:1/)
    assert.match(sql, /'tasks', 43, 'inventory_only'/)
    assert.match(sql, /'schedule', 8, 'captured'/)
    assert.doesNotMatch(sql, /status='published'/)
    assert.doesNotMatch(sql, /lifecycle_status='active'/)
    assert.doesNotMatch(sql, /department_code[^;]*'ORC'/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("refuses whole-template publication for the non-pilot schedule scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "compass-nonpilot-schedules-"))
  const output = join(directory, "nonpilot-schedules.sql")
  try {
    await assert.rejects(
      () => execFileAsync("bun", command(output, ["--publish-captured-schedules"])),
      /draft-import only; whole-template publishing remains gated/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects a non-pilot manifest that no longer matches reviewed schedule evidence", async () => {
  const { buildBuildertrendTemplateScheduleScope } = await import(
    "./lib/buildertrend-template-schedule-scope.mjs"
  )
  const [inventory, capture, workplan, pilotManifest, manifest] = await Promise.all(
    [inventoryPath, capturePath, workplanPath, pilotManifestPath, scheduleManifestPath]
      .map(async (path) => JSON.parse(await readFile(path, "utf8")))
  )
  manifest.templates[0].scheduleItemCount = 7
  assert.throws(
    () => buildBuildertrendTemplateScheduleScope({
      inventory,
      capture,
      workplan,
      pilotManifest,
      manifest,
    }),
    /Schedule item audit mismatch/
  )
})
