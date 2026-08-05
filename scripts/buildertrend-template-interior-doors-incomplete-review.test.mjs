import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const interiorDoorsTemplateId = "28466146"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/27-28466146.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the Interior Doors capture gates without inventing browser evidence", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, interiorDoorsTemplateId)
  assert.equal("copiedTargetTemplateId" in review.template, false)
  assert.equal("copiedTargetName" in review.template, false)
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 5,
    scheduleDuration: "4 Days",
    scheduleItems: 3,
    selections: 4,
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
      { module: "tasks", expectedCount: 5, capturedCount: 0, status: "incomplete" },
      { module: "selections", expectedCount: 4, capturedCount: 0, status: "incomplete" },
    ]
  )
  assert.equal(review.template.browserModuleGates.every((gate) => gate.releaseBlocker.length > 0), true)
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("keeps incomplete Interior Doors out of release and preserves canonical schedule truth", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === interiorDoorsTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === interiorDoorsTemplateId),
    false
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)

  const reviewedInteriorDoors = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === interiorDoorsTemplateId
  )
  assert.ok(reviewedInteriorDoors)
  assert.deepEqual(
    reviewedInteriorDoors.schedule.items.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "166641616",
        title: "Interior Door Delivery",
        startDate: "2023-03-08",
        workdays: 1,
        phase: "UNASSIGNED",
        displayColor: "#DDC817",
      },
      {
        sourceItemId: "166641633",
        title: "Interior Door Installation",
        startDate: "2023-03-09",
        workdays: 2,
        phase: "UNASSIGNED",
        displayColor: "#008000",
      },
      {
        sourceItemId: "180251529",
        title: "HPS Interior Door QC Inspection",
        startDate: "2023-03-13",
        workdays: 1,
        phase: "Interior Finish",
        displayColor: "#2222DD",
      },
    ]
  )
  assert.deepEqual(reviewedInteriorDoors.schedule.dependencies, [
    {
      predecessorSourceItemId: "166641616",
      successorSourceItemId: "166641633",
      type: "FS",
      lagDays: 0,
    },
    {
      predecessorSourceItemId: "166641633",
      successorSourceItemId: "180251529",
      type: "FS",
      lagDays: 0,
    },
  ])
})
