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

test("assembles the four gate-complete templates with reviewed schedules", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())

  assert.deepEqual(
    result.capture.assembly.sourceTemplateIds,
    ["12859981", "12978371", "12581937", "12594475"]
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 30)
  assert.equal(result.capture.assembly.excludedArchivedTemplateCount, 27)
  assert.equal(result.capture.assembly.eligibleAfterThisBatch, 0)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + item.tasks.length, 0), 172)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + item.scheduleItems.length, 0), 30)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + (item.selections?.length ?? 0), 0), 4)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + (item.bidPackages?.length ?? 0), 0), 4)
  assert.equal(result.capture.templates.reduce(
    (sum, item) => sum + item.scheduleItems.flatMap((row) => row.predecessors).length,
    0
  ), 25)
  assert.equal(result.inventory.expectedActiveCount, 4)
  assert.equal(result.inventory.excludedArchivedCount, 27)
  assert.deepEqual(
    result.inventory.templates.map((template) => template.sourceTemplateId),
    ["12859981", "12978371", "12581937", "12594475"]
  )
})

test("preserves the reviewed Concrete Slab checklist, schedule, and bid specifications", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const slab = result.capture.templates.find((template) => template.sourceTemplateId === "12594475")
  assert.ok(slab)
  assert.equal(slab.tasks.length, 36)
  assert.equal(slab.tasks.filter((task) => task.parentSourceItemId === null).length, 15)
  assert.equal(slab.tasks.filter((task) => task.parentSourceItemId !== null).length, 21)
  assert.deepEqual(
    slab.tasks.filter((task) => task.parentSourceItemId === "75705647").map((task) => task.title),
    ["Final Grade @ Correct Elevation", "Final Grade @ Correct Slope"]
  )
  assert.deepEqual(
    slab.tasks.filter((task) => task.parentSourceItemId === "75705682").map((task) => task.title),
    [
      "Slab is Flat",
      "No Dips",
      "Radiant Lines Pressurized to 60 psi",
      "Rigid Insulation in Stagger Pattern",
      "Rigid Insulation Taped",
      "Slab Reinforcing Installed",
      "Slab at Correct Elevation",
    ]
  )
  assert.equal(slab.tasks.filter((task) => task.parentSourceItemId === "75705684").length, 12)
  assert.equal(slab.scheduleItems.length, 8)
  assert.equal(slab.scheduleItems.flatMap((item) => item.predecessors).length, 8)

  assert.equal(slab.bidPackages.length, 1)
  const bidPackage = slab.bidPackages[0]
  assert.equal(bidPackage.sourceBidPackageId, "10290610")
  assert.equal(bidPackage.title, "Flat Work - (Project Address) (Estimate Phase)")
  assert.equal(bidPackage.status, "Draft")
  assert.equal(bidPackage.pricingFormat, "Line Items")
  assert.match(bidPackage.description, /Contract and Insurance Requirements/)
  assert.match(bidPackage.internalNotes, /Input the SQFT into the QTY Line/)
  assert.deepEqual(
    bidPackage.lineItems.map((item) => ({
      sourceLineItemId: item.sourceLineItemId,
      costCode: item.costCode,
      costType: item.costType,
      unit: item.unit,
      description: item.description,
    })),
    [
      {
        sourceLineItemId: "17860313",
        costCode: "03 35 00 - Concrete Finishing",
        costType: "Subcontractor",
        unit: "SQFT",
        description: "Concrete CUYD: (X) CUYD, Finish: Slick",
      },
      {
        sourceLineItemId: "17860314",
        costCode: "32 13 13 - Concrete Paving",
        costType: "Subcontractor",
        unit: "SQFT",
        description: "Concrete CUYD: (X) CUYD; Finish: Broom",
      },
    ]
  )
})

test("rejects partial capture, duplicate release scope, and publication requests", async () => {
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
    /duplicates a sourceTemplateId/
  )

  const publish = await inputs()
  publish.publishRequested = true
  assert.throws(
    () => assembleBuildertrendTemplateNextBatchContent(publish),
    /publication requests are prohibited/
  )
})

test("builds SQL that remains draft-only and includes Concrete Slab", async () => {
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
      templateCount: 4,
      tasks: 172,
      scheduleItems: 30,
      selections: 4,
      bidPackages: 4,
      excludedArchivedCount: 27,
      draftOnly: true,
      output,
    })
    const sql = await readFile(output, "utf8")
    assert.match(sql, /bt-template-version:12859981:1/)
    assert.match(sql, /bt-template-version:12978371:1/)
    assert.match(sql, /bt-template-version:12581937:1/)
    assert.match(sql, /bt-template-version:12594475:1/)
    assert.match(sql, /INSERT INTO schedule_template_items/)
    assert.match(sql, /review_status='content_captured', lifecycle_status='draft'/)
    assert.doesNotMatch(sql, /status='published'|lifecycle_status='active'|review_status='verified'/)

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
