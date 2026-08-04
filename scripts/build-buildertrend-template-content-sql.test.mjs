import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const inventory = {
  expectedActiveCount: 1,
  excludedArchivedCount: 0,
  templates: [
    {
      sourceTemplateId: "template-1",
      name: "Foundation",
      moduleCounts: { tasks: 1, selections: 0, bidPackages: 0 },
    },
  ],
}

const capture = {
  capturedAt: "2026-08-03T15:30:00.000Z",
  excludedArchivedCount: 0,
  templates: [
    {
      sourceTemplateId: "template-1",
      name: "Foundation",
      tasks: [{ sourceItemId: "task-1", title: "Form footers" }],
      selections: [],
      bidPackages: [],
    },
  ],
}

async function runImport(inputCapture, { dryRun = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "compass-template-content-"))
  const inventoryPath = join(directory, "inventory.json")
  const capturePath = join(directory, "capture.json")
  const outputPath = join(directory, "import.sql")
  await Promise.all([
    writeFile(inventoryPath, JSON.stringify(inventory)),
    writeFile(capturePath, JSON.stringify(inputCapture)),
  ])
  try {
    const argumentsList = [
      "scripts/build-buildertrend-template-content-sql.mjs",
      "--inventory",
      inventoryPath,
      "--capture",
      capturePath,
    ]
    if (dryRun) {
      argumentsList.push("--dry-run")
    } else {
      argumentsList.push("--output", outputPath)
    }
    const result = await execFileAsync("bun", argumentsList)
    return {
      ...result,
      sql: dryRun ? null : await readFile(outputPath, "utf8"),
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("preserves documented field conversion exceptions in module and item provenance", async () => {
  const input = structuredClone(capture)
  input.conversionExceptions = [
    {
      templateSourceTemplateId: "template-1",
      module: "tasks",
      sourceItemId: "task-1",
      field: "costType",
      sourceValue: "Labor",
      loss: "Compass does not import Buildertrend cost types.",
      recoveryPlan: "Map the cost type after the Sage cost-code migration.",
    },
  ]

  const result = await runImport(input)

  assert.match(result.sql, /normalization_status='captured_with_warnings'/)
  assert.match(result.sql, /"conversionExceptions"/)
  assert.match(result.sql, /"sourceItemId":"task-1"/)
  assert.match(result.sql, /"sourceValue":"Labor"/)
  assert.match(result.sql, /"recoveryPlan":"Map the cost type after the Sage cost-code migration\."/)
})

test("dry-run reports the exact captured module counts", async () => {
  const result = await runImport(capture, { dryRun: true })

  assert.deepEqual(JSON.parse(result.stdout), {
    templateCount: 1,
    tasks: 1,
    selections: 0,
    bidPackages: 0,
    excludedArchivedCount: 0,
    output: null,
  })
})

test("does not let a documented field exception conceal a missing content item", async () => {
  const input = structuredClone(capture)
  input.templates[0].tasks = []
  input.conversionExceptions = [
    {
      templateSourceTemplateId: "template-1",
      module: "tasks",
      sourceItemId: null,
      field: "costTypes",
      sourceValue: ["Labor", "Material"],
      loss: "Cost types need a later mapping.",
      recoveryPlan: "Map them after the Sage cost-code migration.",
    },
  ]

  await assert.rejects(
    () => runImport(input),
    /Foundation tasks count mismatch: expected 1, captured 0\./
  )
})

test("rejects item exceptions that do not point to captured content", async () => {
  const input = structuredClone(capture)
  input.conversionExceptions = [
    {
      templateSourceTemplateId: "template-1",
      module: "tasks",
      sourceItemId: "missing-task",
      field: "costType",
      sourceValue: "Labor",
      loss: "Cost types need a later mapping.",
      recoveryPlan: "Map them after the Sage cost-code migration.",
    },
  ]

  await assert.rejects(
    () => runImport(input),
    /sourceItemId does not identify a captured tasks item\./
  )
})
