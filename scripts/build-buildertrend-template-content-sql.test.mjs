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
      moduleCounts: { tasks: 1, scheduleItems: 1, selections: 0, bidPackages: 0 },
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
      schedule: { sourceAnchorDate: "2026-08-03" },
      tasks: [{ sourceItemId: "task-1", title: "Form footers" }],
      scheduleItems: [
        {
          sourceItemId: "schedule-1",
          title: "Pour footers",
          startDate: "2026-08-03",
          workdays: 1,
          phase: "Foundation",
          predecessors: [],
        },
      ],
      selections: [],
      bidPackages: [],
    },
  ],
}

async function runImport(inputCapture, { dryRun = false, inputInventory = inventory } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "compass-template-content-"))
  const inventoryPath = join(directory, "inventory.json")
  const capturePath = join(directory, "capture.json")
  const outputPath = join(directory, "import.sql")
  await Promise.all([
    writeFile(inventoryPath, JSON.stringify(inputInventory)),
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
  assert.match(result.sql, /project_template_versions WHERE id='bt-template-version:template-1:1' AND status='draft'/)
})

test("dry-run reports the exact captured module counts", async () => {
  const result = await runImport(capture, { dryRun: true })

  assert.deepEqual(JSON.parse(result.stdout), {
    templateCount: 1,
    tasks: 1,
    scheduleItems: 1,
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

test("rejects duplicate content source IDs before generating SQL", async () => {
  const input = structuredClone(capture)
  input.templates[0].tasks = [
    { sourceItemId: "task-1", title: "Form footers" },
  ]
  const duplicateInventory = structuredClone(inventory)
  duplicateInventory.templates[0].moduleCounts.tasks = 2
  input.templates[0].tasks.push({ sourceItemId: "task-1", title: "Duplicate footers" })

  const directory = await mkdtemp(join(tmpdir(), "compass-template-content-"))
  const inventoryPath = join(directory, "inventory.json")
  const capturePath = join(directory, "capture.json")
  const outputPath = join(directory, "import.sql")
  await Promise.all([
    writeFile(inventoryPath, JSON.stringify(duplicateInventory)),
    writeFile(capturePath, JSON.stringify(input)),
  ])
  try {
    await assert.rejects(
      () => execFileAsync("bun", [
        "scripts/build-buildertrend-template-content-sql.mjs",
        "--inventory", inventoryPath,
        "--capture", capturePath,
        "--output", outputPath,
      ]),
      /duplicate sourceItemId task-1/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects schedule predecessors that do not reference captured schedule items", async () => {
  const input = structuredClone(capture)
  input.templates[0].scheduleItems[0].predecessors = [
    {
      predecessorSourceItemId: "missing-schedule-item",
      successorSourceItemId: "schedule-1",
      type: "FS",
      lagDays: 0,
    },
  ]

  await assert.rejects(
    () => runImport(input),
    /predecessorSourceItemId does not identify a captured schedule item\./
  )
})

test("materializes all five reviewed Stucco schedule rows for the publish count gate", async () => {
  const reviewedCapture = JSON.parse(await readFile(
    "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
    "utf8"
  ))
  const reviewedStucco = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === "12859981"
  )
  assert.ok(reviewedStucco)
  assert.equal(reviewedStucco.moduleCounts.scheduleItems, 5)
  const predecessorsBySuccessor = new Map()
  for (const predecessor of reviewedStucco.schedule.dependencies) {
    const current = predecessorsBySuccessor.get(predecessor.successorSourceItemId) ?? []
    current.push(predecessor)
    predecessorsBySuccessor.set(predecessor.successorSourceItemId, current)
  }
  const scheduleItems = reviewedStucco.schedule.items.map((item) => ({
    ...item,
    predecessors: predecessorsBySuccessor.get(item.sourceItemId) ?? [],
  }))
  const stuccoCapture = {
    capturedAt: reviewedCapture.capturedAt,
    excludedArchivedCount: 27,
    templates: [{
      sourceTemplateId: reviewedStucco.sourceTemplateId,
      name: reviewedStucco.name,
      schedule: reviewedStucco.schedule,
      tasks: [],
      scheduleItems,
      selections: [],
      bidPackages: [],
    }],
  }
  const stuccoInventory = {
    expectedActiveCount: 1,
    excludedArchivedCount: 27,
    templates: [{
      sourceTemplateId: reviewedStucco.sourceTemplateId,
      name: reviewedStucco.name,
      moduleCounts: { tasks: 0, scheduleItems: 5, selections: 0, bidPackages: 0 },
    }],
  }

  const result = await runImport(stuccoCapture, { inputInventory: stuccoInventory })
  assert.equal((result.sql.match(/INSERT INTO schedule_template_items/g) ?? []).length, 5)
  assert.equal(
    (result.sql.match(/INSERT INTO schedule_template_dependencies/g) ?? []).length,
    4
  )
  assert.match(result.sql, /DELETE FROM schedule_template_items/)
  assert.match(result.sql, /bt-template-item:12859981:143866298/)
  assert.match(result.sql, /bt-template-item:12859981:143867153/)
  assert.match(result.sql, /WHERE id='bt-template-version:12859981:1' AND status='draft'/)
})

test("converts the complete six-template pilot with exact counts and draft guards", async () => {
  const canonicalCapture = JSON.parse(
    await readFile(
      "scripts/fixtures/buildertrend-template-content-pilot-2026-08-03.json",
      "utf8"
    )
  )
  const canonicalInventory = JSON.parse(
    await readFile(
      "scripts/fixtures/buildertrend-template-content-pilot-inventory-2026-08-03.json",
      "utf8"
    )
  )
  const directory = await mkdtemp(join(tmpdir(), "compass-template-content-"))
  const inventoryPath = join(directory, "inventory.json")
  const capturePath = join(directory, "capture.json")
  const outputPath = join(directory, "import.sql")
  await Promise.all([
    writeFile(inventoryPath, JSON.stringify(canonicalInventory)),
    writeFile(capturePath, JSON.stringify(canonicalCapture)),
  ])
  try {
    const result = await execFileAsync("bun", [
      "scripts/build-buildertrend-template-content-sql.mjs",
      "--inventory", inventoryPath,
      "--capture", capturePath,
      "--output", outputPath,
    ])
    assert.deepEqual(JSON.parse(result.stdout), {
      templateCount: 6,
      tasks: 249,
      scheduleItems: 70,
      selections: 110,
      bidPackages: 4,
      excludedArchivedCount: 27,
      output: outputPath,
    })
    const sql = await readFile(outputPath, "utf8")
    assert.equal(
      (sql.match(/INSERT INTO project_template_content_items/g) ?? []).length,
      433
    )
    assert.equal((sql.match(/INSERT INTO schedule_template_items/g) ?? []).length, 70)
    assert.match(
      sql,
      /WHERE id='bt-template-version:30294726:1' AND status='draft'/
    )
    assert.match(sql, /normalization_status='captured_with_warnings'/)
    assert.match(sql, /module_type='schedule'/)
    assert.match(sql, /"sourceItemId":"176749752"/)
    assert.match(sql, /"predecessorSourceItemId":"176749752"/)
    assert.match(
      sql,
      /"field":"milestone,assignee,ownerVisibility,subVendorVisibility,notes"/
    )
    assert.match(
      sql,
      /DELETE FROM project_template_content_items WHERE version_id='bt-template-version:30294726:1' AND module_type='schedule'/
    )
    assert.match(sql, /\"field\":\"sourceItemId\"/)
    assert.match(sql, /\"field\":\"attachmentBytes\"/)
    assert.match(sql, /\"field\":\"costType\"/)
    assert.match(sql, /review_status=CASE WHEN review_status='verified'/)
    assert.doesNotMatch(sql, /review_status='verified', lifecycle_status='active'/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
