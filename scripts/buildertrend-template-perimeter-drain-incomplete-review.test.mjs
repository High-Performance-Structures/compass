import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const perimeterDrainTemplateId = "13001090"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/29-13001090.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the Perimeter Drain capture gate without inventing browser evidence", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, perimeterDrainTemplateId)
  assert.equal(review.template.capturedAt, "2026-08-05T07:45:40Z")
  assert.equal("copiedTargetTemplateId" in review.template, false)
  assert.equal("copiedTargetName" in review.template, false)
  assert.equal(
    review.template.captureNotes.some((note) => note.includes("previously selected Int. Finishes - Stain & Seal Concrete Floors template 12979213")),
    true
  )
  assert.equal(
    review.template.captureNotes.some((note) => note.includes("No task identity, hierarchy, title, description, assignment, or attachment value was inferred")),
    true
  )
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 4,
    scheduleDuration: "3 Days",
    scheduleItems: 3,
    selections: 0,
    bidPackages: 0,
  })
  assert.deepEqual(
    review.template.browserModuleGates.map((gate) => ({
      module: gate.module,
      expectedCount: gate.expectedCount,
      capturedCount: gate.capturedCount,
      status: gate.status,
    })),
    [
      { module: "tasks", expectedCount: 4, capturedCount: 0, status: "incomplete" },
    ]
  )
  assert.equal(review.template.browserModuleGates.every((gate) => gate.releaseBlocker.length > 0), true)
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("keeps incomplete Perimeter Drain out of release and preserves canonical schedule truth", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === perimeterDrainTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === perimeterDrainTemplateId),
    false
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)

  const reviewedPerimeterDrain = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === perimeterDrainTemplateId
  )
  assert.ok(reviewedPerimeterDrain)
  assert.deepEqual(
    reviewedPerimeterDrain.schedule.items.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "145341521",
        title: "Perimeter Drain Grading",
        startDate: "2022-05-25",
        workdays: 1,
        phase: "Structure-Shell: FDN",
        displayColor: "#442121",
      },
      {
        sourceItemId: "145341568",
        title: "Perimeter Drain Installation",
        startDate: "2022-05-26",
        workdays: 2,
        phase: "Structure-Shell: FDN",
        displayColor: "#5283AD",
      },
      {
        sourceItemId: "145342287",
        title: "Roll On Waterproofing",
        startDate: "2022-05-26",
        workdays: 1,
        phase: "Structure-Shell: FDN",
        displayColor: "#5283AD",
      },
    ]
  )
  assert.deepEqual(reviewedPerimeterDrain.schedule.dependencies, [
    {
      predecessorSourceItemId: "145341521",
      successorSourceItemId: "145341568",
      type: "SS",
      lagDays: 0,
    },
    {
      predecessorSourceItemId: "145342287",
      successorSourceItemId: "145341568",
      type: "SS",
      lagDays: 0,
    },
    {
      predecessorSourceItemId: "145341521",
      successorSourceItemId: "145342287",
      type: "FS",
      lagDays: 0,
    },
  ])
})
