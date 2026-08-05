import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const stairInstallationTemplateId = "12650713"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/26-12650713.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the Stair Installation capture gate without inventing browser evidence", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, stairInstallationTemplateId)
  assert.equal("copiedTargetTemplateId" in review.template, false)
  assert.equal("copiedTargetName" in review.template, false)
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 10,
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
      { module: "tasks", expectedCount: 10, capturedCount: 0, status: "incomplete" },
    ]
  )
  assert.equal(review.template.browserModuleGates.every((gate) => gate.releaseBlocker.length > 0), true)
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("keeps incomplete Stair Installation out of release and preserves canonical schedule truth", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === stairInstallationTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === stairInstallationTemplateId),
    false
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)

  const reviewedStairInstallation = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === stairInstallationTemplateId
  )
  assert.ok(reviewedStairInstallation)
  assert.deepEqual(
    reviewedStairInstallation.schedule.items.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "141694608",
        title: "Frame & Sheet (X) Level Landing",
        startDate: "2022-04-13",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#ABBE91",
      },
      {
        sourceItemId: "141695005",
        title: "Install (X) Level Stairs",
        startDate: "2022-04-14",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#ABBE91",
      },
      {
        sourceItemId: "141695420",
        title: "HPS (X) Level Stair Installation QC Inspection",
        startDate: "2022-04-15",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#2222DD",
      },
    ]
  )
  assert.deepEqual(reviewedStairInstallation.schedule.dependencies, [
    {
      predecessorSourceItemId: "141694608",
      successorSourceItemId: "141695005",
      type: "FS",
      lagDays: 0,
    },
    {
      predecessorSourceItemId: "141695005",
      successorSourceItemId: "141695420",
      type: "FS",
      lagDays: 0,
    },
  ])
})
