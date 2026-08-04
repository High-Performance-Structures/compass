import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import test from "node:test"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const validator = "scripts/validate-buildertrend-template-content-pilot.mjs"
const capture = "scripts/fixtures/buildertrend-template-content-pilot-2026-08-03.json"

test("reports the canonical capture as a complete six-template pilot", async () => {
  const result = await execFileAsync("bun", [validator, "--input", capture])
  const summary = JSON.parse(result.stdout)

  assert.equal(summary.complete, true)
  assert.equal(summary.templateCount, 6)
  assert.equal(summary.excludedArchivedCount, 27)
  assert.equal(summary.remainingActiveTemplatesUnverified, 34)
  assert.equal(summary.totals.tasks, 249)
  assert.equal(summary.totals.scheduleItems, 70)
  assert.equal(summary.totals.selections, 110)
  assert.equal(summary.totals.bidPackages, 4)
  assert.deepEqual(summary.missing, [])
})

test("allow-incomplete never downgrades a complete reviewed capture", async () => {
  const result = await execFileAsync("bun", [validator, "--input", capture, "--allow-incomplete"])
  assert.equal(JSON.parse(result.stdout).complete, true)
})
