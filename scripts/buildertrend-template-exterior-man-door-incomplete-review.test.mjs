import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const sourceTemplateId = "12650484"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/24-12650484.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("keeps Exterior Man Door fail closed until all browser modules are captured", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, sourceTemplateId)
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 11,
    scheduleDuration: "3 Days",
    scheduleItems: 2,
    selections: 1,
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
      { module: "tasks", expectedCount: 11, capturedCount: 0, status: "incomplete" },
      { module: "selections", expectedCount: 1, capturedCount: 0, status: "incomplete" },
      { module: "bidPackages", expectedCount: 1, capturedCount: 0, status: "incomplete" },
    ]
  )
  assert.equal(review.template.browserModuleGates.every((gate) => gate.releaseBlocker.length > 0), true)
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("excludes the incomplete Exterior Man Door checkpoint and preserves reviewed schedule truth", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === sourceTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === sourceTemplateId),
    false
  )

  const reviewedTemplate = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === sourceTemplateId
  )
  assert.ok(reviewedTemplate)
  assert.deepEqual(
    reviewedTemplate.schedule.items.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "141692419",
        title: "Install (X) Level Exterior Man Doors",
        startDate: "2022-04-13",
        workdays: 2,
        phase: "Rough: Frame",
        displayColor: "#ABBE91",
      },
      {
        sourceItemId: "141692914",
        title: "HPS (X) Level Exterior Man Door QC Inspection",
        startDate: "2022-04-15",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#2222DD",
      },
    ]
  )
  assert.deepEqual(reviewedTemplate.schedule.dependencies, [
    {
      predecessorSourceItemId: "141692419",
      successorSourceItemId: "141692914",
      type: "FS",
      lagDays: 0,
    },
  ])
})
