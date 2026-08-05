import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const architecturalId = "12796241"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/14-12796241.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves Architectural Woodwork evidence as an incomplete audit", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, architecturalId)
  assert.deepEqual(review.template.captureGate, {
    status: "incomplete",
    module: "tasks",
    expectedCount: 19,
    capturedCount: 18,
    missingCount: 1,
    reason: "The missing task is not exposed by the authenticated source or copied-template All Tasks, deleted-task, hierarchy, filter, pagination, or related-action views.",
    releaseBlocker: "Recover one additional source task with a native ID and title from a supported Buildertrend view or export before moving this file into the active fragments directory.",
  })
  assert.deepEqual(review.template.reviewedScheduleReference, {
    path: paths.reviewed,
    sourceTemplateId: architecturalId,
    scheduleItemCount: 4,
    dependencyCount: 3,
    note: "The reviewed source capture remains the canonical schedule record; browser fragments do not duplicate schedule rows.",
  })

  assert.equal(review.template.tasks.length, 18)
  assert.equal(new Set(review.template.tasks.map((task) => task.sourceItemId)).size, 18)
  assert.equal(new Set(review.template.tasks.map((task) => task.originalSourceItemId)).size, 18)
  assert.equal(review.template.tasks.every((task) => task.parentSourceItemId === null), true)
  assert.deepEqual(
    review.template.tasks.map((task) => task.sortOrder),
    Array.from({ length: 18 }, (_, index) => index + 1)
  )
  assert.deepEqual(
    review.template.tasks.map((task) => [task.sourceItemId, task.originalSourceItemId, task.title]),
    [
      ["180202325", "75713764", "Paint/Stain (X) Room Baseboards (X) Color"],
      ["180202326", "75713768", "Paint/Stain (X) Room Casework (X) Color"],
      ["180202327", "75713770", "Paint/Stain (X) Room Chair Rail (X) Color"],
      ["180202328", "75713772", "Install (X) Room Baseboards"],
      ["180202329", "75713774", "Install (X) Room Casework"],
      ["180202330", "75713775", "Install (X) Room Chair Rail"],
      ["180202331", "75713776", "Tape (X) Room Baseboards"],
      ["180202332", "75713777", "Tape (X) Room Casework"],
      ["180202333", "75713778", "Tape (X) Room Chair Rail"],
      ["180202334", "75713779", "Caulk (X) Room Baseboard Seam"],
      ["180202335", "75713781", "Caulk (X) Room Casework Seam"],
      ["180202336", "75713783", "Caulk (X) Room Chair Rail Seam"],
      ["180202337", "75713785", "Recess (X) Room Baseboard Nails"],
      ["180202338", "75713787", "Recess (X) Room Casework Nails"],
      ["180202339", "75713789", "Recess (X) Room Chair Rail Nails"],
      ["180202340", "75713800", "Caulk (X) Room Baseboard Recessed Nails"],
      ["180202341", "75713802", "Caulk (X) Room Casework Recessed Nails"],
      ["180202342", "75713804", "Caulk (X) Room Chair Rail Recessed Nails"],
    ]
  )

  assert.equal(review.template.selections.length, 5)
  assert.equal(review.template.selections.flatMap((selection) => selection.choices).length, 65)
  assert.deepEqual(
    review.template.selections.map((selection) => [selection.sourceSelectionId, selection.title]),
    [
      ["63637830", "Baseboard Profile"],
      ["63637831", "Baseboards & Casework Grade"],
      ["63637832", "Door Case Profile"],
      ["63637833", "Stain Grade Trim Wood Species"],
      ["63637834", "Interior Trim Specialty Options"],
    ]
  )
  assert.equal(review.template.bidPackages.length, 2)
  assert.equal(review.template.bidPackages.flatMap((bidPackage) => bidPackage.lineItems).length, 5)
  assert.deepEqual(
    review.template.bidPackages.map((bidPackage) => [bidPackage.sourceBidPackageId, bidPackage.title]),
    [
      ["13414572", "Int Door Pack - (Project Address) (Estimate Phase)"],
      ["13414571", "Trim Carpentry - (Project Address) (Est. Phase)"],
    ]
  )
  assert.equal(review.conversionExceptions.length, 3)
  assert.equal(
    review.conversionExceptions.every((exception) =>
      exception.templateSourceTemplateId === architecturalId &&
      exception.module === "bidPackages" &&
      exception.sourceItemId === null &&
      exception.field.startsWith("lineItems.multipleCostTypes[")
    ),
    true
  )
})

test("excludes incomplete audits from fragment discovery and release assembly", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(
    documents.some(({ source }) => source.includes("incomplete-reviews")),
    false
  )
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === architecturalId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === architecturalId),
    false
  )

  const reviewedArchitectural = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === architecturalId
  )
  assert.ok(reviewedArchitectural)
  assert.equal(reviewedArchitectural.schedule.items.length, 4)
  assert.equal(reviewedArchitectural.schedule.dependencies.length, 3)
  assert.deepEqual(
    reviewedArchitectural.schedule.items.map((item) => [item.sourceItemId, item.title]),
    [
      ["143157341", "Paint/Stain Architectural Woodwork"],
      ["180198338", "Architectural Woodwork"],
      ["143157501", "Baseboard & Casework Installation"],
      ["143408018", "HPS Millwork QC Inspection"],
    ]
  )
  assert.deepEqual(reviewedArchitectural.schedule.dependencies, [
    {
      predecessorSourceItemId: "143157341",
      successorSourceItemId: "180198338",
      type: "FS",
      lagDays: 0,
    },
    {
      predecessorSourceItemId: "143157341",
      successorSourceItemId: "143157501",
      type: "FS",
      lagDays: 0,
    },
    {
      predecessorSourceItemId: "143157501",
      successorSourceItemId: "143408018",
      type: "FS",
      lagDays: 0,
    },
  ])
})
