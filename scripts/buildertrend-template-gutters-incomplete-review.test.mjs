import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const guttersTemplateId = "12978732"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/19-12978732.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the exact Manufactured Gutters checkpoint as a fail-closed audit", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, guttersTemplateId)
  assert.equal("copiedTargetTemplateId" in review.template, false)
  assert.equal("copiedTargetName" in review.template, false)
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 17,
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
      { module: "tasks", expectedCount: 17, capturedCount: 0, status: "incomplete" },
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

test("keeps the incomplete Manufactured Gutters audit out of release and preserves schedule truth", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === guttersTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === guttersTemplateId),
    false
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
  assert.equal(result.capture.assembly.templateCount, 23)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 11)

  const reviewedGutters = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === guttersTemplateId
  )
  assert.ok(reviewedGutters)
  assert.deepEqual(
    reviewedGutters.schedule.items.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "145104838",
        title: "Manufactured Gutters & Downspouts",
        startDate: "2022-05-23",
        workdays: 3,
        phase: "Exterior Finish",
        displayColor: "#6C3815",
      },
      {
        sourceItemId: "145111028",
        title: "HPS Manuf. Gutter & Downspout QC Inspection",
        startDate: "2022-05-26",
        workdays: 1,
        phase: "Exterior Finish",
        displayColor: "#2222DD",
      },
    ]
  )
  assert.deepEqual(reviewedGutters.schedule.dependencies, [
    {
      predecessorSourceItemId: "145104838",
      successorSourceItemId: "145111028",
      type: "FS",
      lagDays: 0,
    },
  ])
})
