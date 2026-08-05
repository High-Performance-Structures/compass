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

test("assembles the six gate-complete priority templates with reviewed schedules", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())

  assert.deepEqual(
    result.capture.assembly.sourceTemplateIds,
    ["12859981", "12978371", "12581937", "12594475", "30917204", "12646335"]
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 28)
  assert.equal(result.capture.assembly.excludedArchivedTemplateCount, 27)
  assert.equal(result.capture.assembly.eligibleAfterThisBatch, 0)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + item.tasks.length, 0), 235)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + item.scheduleItems.length, 0), 35)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + (item.selections?.length ?? 0), 0), 8)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + (item.bidPackages?.length ?? 0), 0), 6)
  assert.equal(result.capture.templates.reduce(
    (sum, item) => sum + item.scheduleItems.flatMap((row) => row.predecessors).length,
    0
  ), 28)
  assert.equal(result.inventory.expectedActiveCount, 6)
  assert.equal(result.inventory.excludedArchivedCount, 27)
  assert.deepEqual(
    result.inventory.templates.map((template) => template.sourceTemplateId),
    ["12859981", "12978371", "12581937", "12594475", "30917204", "12646335"]
  )
})

test("preserves the reviewed Siding hierarchy, selections, bid package, and copy warnings", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const siding = result.capture.templates.find((template) => template.sourceTemplateId === "30917204")
  assert.ok(siding)
  assert.equal(siding.tasks.length, 29)
  assert.equal(siding.tasks.filter((task) => task.parentSourceItemId === null).length, 3)
  assert.deepEqual(
    siding.tasks.filter((task) => task.parentSourceItemId === "180199031").map((task) => task.title),
    [
      "Level Horizontally",
      "Level Vertically",
      "Joints Blocked & Butt Joints Caulked or Concealed w/ Batten Strips",
      "Nails Recessed & Caulked",
      "Drip Cap",
      "Corner Detailing",
      "Wedges",
      "Chinking completed",
      "No Gouges",
      "No Cracks",
      "No Breaking",
      "No Exposed Underlayment",
      "No Buckles or Ripples",
      "No Dents",
      "No Chips",
      "No Scratches",
      "No Loose Siding",
      "No Shrinking",
      "No Twists",
      "No Bows",
      "No Knots Falling Out (Wood Siding)",
      "No Splits @ Nails",
      "Lap on Bevel Siding",
      "No Delamination",
      "Jobsite Cleanup Satisfactory",
      "OK to Pay",
    ]
  )
  assert.deepEqual(
    siding.tasks.filter((task) => task.parentSourceItemId === "180199031").map((task) => task.sortOrder),
    Array.from({ length: 26 }, (_, index) => index + 1)
  )

  assert.equal(siding.selections.length, 4)
  const sidingType = siding.selections.find((selection) => selection.sourceSelectionId === "63637592")
  assert.ok(sidingType)
  assert.equal(sidingType.allowMultipleSelectedChoices, false)
  assert.equal(sidingType.choiceOrdering, "Auto")
  assert.deepEqual(
    sidingType.choices.map((choice) => ({
      sourceChoiceId: choice.sourceChoiceId,
      title: choice.title,
      attachment: choice.attachments[0].fileName,
    })),
    [
      { sourceChoiceId: "262674474", title: "Composite Siding", attachment: "bardage-composite-eternit.jpg" },
      { sourceChoiceId: "262674473", title: "Fiber Cement", attachment: "james-hardie-siding-calgary.jpg" },
      { sourceChoiceId: "262674472", title: "LP SmartSide", attachment: "LP SmartSide.jpg" },
      { sourceChoiceId: "262674476", title: "Metal Siding", attachment: "Metal Siding.jpg" },
      { sourceChoiceId: "262674475", title: "Natural Wood Siding", attachment: "Natural wood siding.jpg" },
      { sourceChoiceId: "262674471", title: "Vinyl Siding", attachment: "Vinyl siding.jpg" },
    ]
  )
  assert.match(
    siding.selections.find((selection) => selection.sourceSelectionId === "63637593").description,
    /select your primary color/
  )
  assert.match(
    siding.selections.find((selection) => selection.sourceSelectionId === "63637594").description,
    /secondary accent color/
  )
  assert.match(
    siding.selections.find((selection) => selection.sourceSelectionId === "63637595").description,
    /siding trim at corners and around openings/
  )

  assert.equal(siding.bidPackages.length, 1)
  const bidPackage = siding.bidPackages[0]
  assert.equal(bidPackage.sourceBidPackageId, "13414442")
  assert.equal(bidPackage.title, "Siding - (Proj. Address) (Est. Phase)")
  assert.equal(bidPackage.pricingFormat, "Line Items")
  assert.deepEqual(
    bidPackage.lineItems.map((lineItem) => ({
      title: lineItem.title,
      costCode: lineItem.costCode,
      costType: lineItem.costType,
    })),
    [
      {
        title: "Metal Siding Installation Labor & Misc. Materials",
        costCode: "07 46 19 - Steel Siding",
        costType: "None",
      },
      {
        title: "Metal Siding Materials",
        costCode: "07 46 19 - Steel Siding",
        costType: "Material",
      },
      {
        title: "Hardie Siding Installation Labor & Misc. Materials",
        costCode: "07 46 46 - Fiber-Cement Siding",
        costType: "None",
      },
      {
        title: "Hardie Siding Materials",
        costCode: "07 46 46 - Fiber-Cement Siding",
        costType: "Material",
      },
    ]
  )

  assert.equal(siding.scheduleItems.length, 3)
  assert.equal(siding.scheduleItems.find((item) => item.sourceItemId === "180238656").title, "HPS Siding QC Inpsection")
  assert.deepEqual(
    siding.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      { predecessorSourceItemId: "180238306", successorSourceItemId: "180238320", type: "SS", lagDays: -1 },
      { predecessorSourceItemId: "180238306", successorSourceItemId: "180238656", type: "FS", lagDays: 0 },
    ]
  )

  const sidingExceptions = result.capture.conversionExceptions.filter(
    (exception) => exception.templateSourceTemplateId === "30917204"
  )
  assert.equal(sidingExceptions.length, 2)
  assert.deepEqual(sidingExceptions.map((exception) => exception.field), [
    "lineItems.multipleCostTypes[0]",
    "lineItems.multipleCostTypes[1]",
  ])
  assert.equal(sidingExceptions.every((exception) => exception.sourceItemId === null), true)
  assert.equal(sidingExceptions.every((exception) => /do not infer/.test(exception.recoveryPlan)), true)
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

test("preserves Interior Wall checklist, bid specifications, and reviewed dependency", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const interiorWall = result.capture.templates.find(
    (template) => template.sourceTemplateId === "12646335"
  )
  assert.ok(interiorWall)
  assert.equal(interiorWall.tasks.length, 34)
  assert.equal(interiorWall.tasks.filter((task) => task.parentSourceItemId === null).length, 6)
  assert.equal(interiorWall.tasks.filter((task) => task.parentSourceItemId !== null).length, 28)

  const taskIds = new Set(interiorWall.tasks.map((task) => task.sourceItemId))
  for (const task of interiorWall.tasks) {
    if (task.parentSourceItemId !== null) assert.equal(taskIds.has(task.parentSourceItemId), true)
  }

  assert.equal(interiorWall.scheduleItems.length, 2)
  assert.deepEqual(interiorWall.scheduleItems[1].predecessors, [{
    predecessorSourceItemId: "141652402",
    successorSourceItemId: "141654663",
    type: "FS",
    lagDays: 0,
  }])

  assert.equal(interiorWall.bidPackages.length, 1)
  const bid = interiorWall.bidPackages[0]
  assert.equal(bid.sourceBidPackageId, "13414443")
  assert.equal(bid.description.includes("Contract and Insurance Requirements"), true)
  assert.deepEqual(
    bid.lineItems.map((item) => item.sourceLineItemId),
    ["23494886", "23494887", "23494888", "23494889", "23494890", "23494891"]
  )
  assert.deepEqual(
    bid.lineItems.map((item) => item.costCode),
    [
      "06 11 00 - Wood Framing",
      "06 15 00 - Wood Decking",
      "06 15 13 - Wood Floor Decking",
      "06 15 16 - Wood Roof Decking",
      "08 00 00 - Openings",
      "08 50 00 - Windows",
    ]
  )
  assert.equal(bid.lineItems.every((item) => item.costType === "Subcontractor"), true)
  assert.equal(bid.lineItems.every((item) => item.description.length > 0), true)
})

test("fails stale when a newly complete template is not in the reviewed release", async () => {
  const stale = await inputs()
  stale.documents.push({
    source: "13-12650792.capture.json",
    document: {
      sourceTemplateId: "12650792",
      sourceName: "Framing - Roof w/ Trusses Assembly",
      tasks: Array.from({ length: 28 }, (_, index) => ({
        sourceItemId: `roof-task-${index + 1}`,
        parentSourceItemId: null,
        title: `Roof task ${index + 1}`,
      })),
    },
  })
  assert.throws(
    () => assembleBuildertrendTemplateNextBatchContent(stale),
    /scope is stale for the currently reviewed fragments/
  )

  const reviewed = structuredClone(stale)
  const roof = reviewed.nextBatchManifest.templates.find(
    (template) => template.sourceTemplateId === "12650792"
  )
  assert.ok(roof)
  reviewed.release.scope.structurallyCompleteTemplatesIncluded = 7
  reviewed.release.scope.incompleteTemplatesExcluded = 27
  reviewed.release.templates.push({
    sourceTemplateId: roof.sourceTemplateId,
    sourceName: roof.sourceName,
    workplanSequence: roof.workplanSequence,
    moduleCounts: roof.moduleCounts,
    fragmentPath: roof.fragmentPath,
    browserCaptureGates: "complete",
  })

  const result = assembleBuildertrendTemplateNextBatchContent(reviewed)
  assert.deepEqual(
    result.capture.assembly.sourceTemplateIds,
    ["12859981", "12978371", "12581937", "12594475", "30917204", "12646335", "12650792"]
  )
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 27)
  assert.equal(result.capture.templates[6].tasks.length, 28)
  assert.equal(result.capture.templates[6].scheduleItems.length, 5)
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

test("builds SQL that remains draft-only and includes every released template", async () => {
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
      templateCount: 6,
      tasks: 235,
      scheduleItems: 35,
      selections: 8,
      bidPackages: 6,
      excludedArchivedCount: 27,
      draftOnly: true,
      output,
    })
    const sql = await readFile(output, "utf8")
    assert.match(sql, /bt-template-version:12859981:1/)
    assert.match(sql, /bt-template-version:12978371:1/)
    assert.match(sql, /bt-template-version:12581937:1/)
    assert.match(sql, /bt-template-version:12594475:1/)
    assert.match(sql, /bt-template-version:30917204:1/)
    assert.match(sql, /bt-template-version:12646335:1/)
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
