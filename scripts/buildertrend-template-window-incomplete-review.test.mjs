import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const windowTemplateId = "12650427"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/17-12650427.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the exact Window checkpoint as a fail-closed audit", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, windowTemplateId)
  assert.equal(review.template.copiedTargetTemplateId, "45894046")
  assert.equal(review.template.copiedTargetName, "BT Framing - Window")
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 20,
    scheduleDuration: "4 Days",
    scheduleItems: 2,
    selections: 2,
    bidPackages: 1,
  })
  assert.deepEqual(
    review.template.browserModuleGates.map((gate) => ({
      module: gate.module,
      expectedCount: gate.expectedCount,
      capturedCount: gate.capturedCount,
      status: gate.status,
    })),
    [
      { module: "tasks", expectedCount: 20, capturedCount: 0, status: "incomplete" },
      { module: "selections", expectedCount: 2, capturedCount: 0, status: "incomplete" },
      { module: "bidPackages", expectedCount: 1, capturedCount: 0, status: "incomplete" },
    ]
  )
  assert.equal(review.template.browserModuleGates.every((gate) => gate.releaseBlocker.length > 0), true)
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("keeps the incomplete Window audit out of discovery and preserves reviewed schedule truth", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === windowTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === windowTemplateId),
    false
  )

  const reviewedWindow = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === windowTemplateId
  )
  assert.ok(reviewedWindow)
  assert.deepEqual(
    reviewedWindow.schedule.items.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "141691840",
        title: "(X) Level Window Installation",
        startDate: "2022-04-13",
        workdays: 3,
        phase: "Rough: Frame",
        displayColor: "#ABBE91",
      },
      {
        sourceItemId: "141691951",
        title: "HPS (X) Level Window Installation QC Inspection",
        startDate: "2022-04-18",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#2222DD",
      },
    ]
  )
  assert.deepEqual(reviewedWindow.schedule.dependencies, [
    {
      predecessorSourceItemId: "141691840",
      successorSourceItemId: "141691951",
      type: "FS",
      lagDays: 0,
    },
  ])
})
