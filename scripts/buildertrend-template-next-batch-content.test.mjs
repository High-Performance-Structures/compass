import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"

import { assembleBuildertrendTemplateNextBatchContent } from "./lib/buildertrend-template-next-batch-content.mjs"

const execFileAsync = promisify(execFile)
const paths = {
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function inputs() {
  const [release, nextBatchManifest, reviewedCapture] = await Promise.all(
    Object.values(paths).map(async (path) => JSON.parse(await readFile(path, "utf8")))
  )
  const documents = await Promise.all(release.templates.map(async (template) => ({
    source: template.fragmentPath,
    document: JSON.parse(await readFile(template.fragmentPath, "utf8")),
  })))
  return { release, nextBatchManifest, reviewedCapture, documents }
}

test("assembles only the two gate-complete templates with reviewed schedules", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())

  assert.deepEqual(result.capture.assembly.sourceTemplateIds, ["12859981", "12978371"])
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 32)
  assert.equal(result.capture.assembly.excludedArchivedTemplateCount, 27)
  assert.equal(result.capture.assembly.eligibleAfterThisBatch, 0)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + item.tasks.length, 0), 93)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + item.scheduleItems.length, 0), 14)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + (item.selections?.length ?? 0), 0), 4)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + (item.bidPackages?.length ?? 0), 0), 3)
  assert.equal(result.capture.templates.reduce(
    (sum, item) => sum + item.scheduleItems.flatMap((row) => row.predecessors).length,
    0
  ), 10)
  assert.equal(result.inventory.expectedActiveCount, 2)
  assert.equal(result.inventory.excludedArchivedCount, 27)
  assert.deepEqual(
    result.inventory.templates.map((template) => template.sourceTemplateId),
    ["12859981", "12978371"]
  )
})

test("keeps Concrete Footer excluded until its exact browser capture is reviewed", async () => {
  const stale = await inputs()
  stale.documents.push({
    source: "08-12581937.capture.json",
    document: {
      sourceTemplateId: "12581937",
      sourceName: "Concrete - Footer Assembly",
      tasks: Array.from({ length: 43 }, (_, index) => ({
        sourceItemId: `footer-task-${index + 1}`,
        parentSourceItemId: null,
        title: `Footer task ${index + 1}`,
      })),
    },
  })
  assert.throws(
    () => assembleBuildertrendTemplateNextBatchContent(stale),
    /scope is stale for the currently reviewed fragments/
  )

  const reviewed = structuredClone(stale)
  const footer = reviewed.nextBatchManifest.templates.find(
    (template) => template.sourceTemplateId === "12581937"
  )
  assert.ok(footer)
  reviewed.release.scope.structurallyCompleteTemplatesIncluded = 3
  reviewed.release.scope.incompleteTemplatesExcluded = 31
  reviewed.release.templates.push({
    sourceTemplateId: footer.sourceTemplateId,
    sourceName: footer.sourceName,
    workplanSequence: footer.workplanSequence,
    moduleCounts: footer.moduleCounts,
    fragmentPath: footer.fragmentPath,
    browserCaptureGates: "complete",
  })

  const result = assembleBuildertrendTemplateNextBatchContent(reviewed)
  assert.deepEqual(
    result.capture.assembly.sourceTemplateIds,
    ["12859981", "12978371", "12581937"]
  )
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 31)
  assert.equal(result.capture.templates[2].tasks.length, 43)
  assert.equal(result.capture.templates[2].scheduleItems.length, 8)
})

test("rejects partial capture, Concrete Footer, and publication requests", async () => {
  const partial = await inputs()
  partial.documents[0].document.tasks = partial.documents[0].document.tasks.slice(1)
  assert.throws(
    () => assembleBuildertrendTemplateNextBatchContent(partial),
    /tasks expected 48, found 47/
  )

  const concrete = await inputs()
  concrete.release.templates.push({
    sourceTemplateId: "12581937",
    sourceName: "Concrete - Footer Assembly",
    fragmentPath: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/08-12581937.capture.json",
    browserCaptureGates: "complete",
  })
  assert.throws(
    () => assembleBuildertrendTemplateNextBatchContent(concrete),
    /included templates do not match the structurally complete fragments/
  )

  const publish = await inputs()
  publish.publishRequested = true
  assert.throws(
    () => assembleBuildertrendTemplateNextBatchContent(publish),
    /publication requests are prohibited/
  )
})

test("builds SQL that remains draft-only and excludes Concrete Footer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "compass-next-batch-content-"))
  const capture = join(directory, "capture.json")
  const inventory = join(directory, "inventory.json")
  const output = join(directory, "import.sql")
  try {
    await execFileAsync("bun", [
      "scripts/assemble-buildertrend-template-next-batch-content.mjs",
      "--capture-output", capture,
      "--inventory-output", inventory,
    ])
    const result = await execFileAsync("bun", [
      "scripts/build-buildertrend-template-next-batch-content-sql.mjs",
      "--capture", capture,
      "--inventory", inventory,
      "--output", output,
    ])
    assert.deepEqual(JSON.parse(result.stdout), {
      templateCount: 2,
      tasks: 93,
      scheduleItems: 14,
      selections: 4,
      bidPackages: 3,
      excludedArchivedCount: 27,
      draftOnly: true,
      output,
    })
    const sql = await readFile(output, "utf8")
    assert.match(sql, /bt-template-version:12859981:1/)
    assert.match(sql, /bt-template-version:12978371:1/)
    assert.match(sql, /review_status='content_captured', lifecycle_status='draft'/)
    assert.doesNotMatch(sql, /12581937|status='published'|lifecycle_status='active'|review_status='verified'/)

    const invalidRelease = join(directory, "invalid-release.json")
    const release = JSON.parse(await readFile(paths.release, "utf8"))
    release.scope.archivedTemplatesIncluded = 1
    await writeFile(invalidRelease, JSON.stringify(release))
    await assert.rejects(
      () => execFileAsync("bun", [
        "scripts/build-buildertrend-template-next-batch-content-sql.mjs",
        "--capture", capture,
        "--inventory", inventory,
        "--release", invalidRelease,
        "--dry-run",
      ]),
      /invalid reviewed scope/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("SQL command rejects publish flags before generating output", async () => {
  await assert.rejects(
    () => execFileAsync("bun", [
      "scripts/build-buildertrend-template-next-batch-content-sql.mjs",
      "--publish-captured-schedules",
    ]),
    /publication requests are prohibited/
  )
})
