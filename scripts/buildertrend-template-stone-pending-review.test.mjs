import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const stoneTemplateId = "37180847"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/36-37180847.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves Stone as a fail-closed pending capture", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "pending")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, stoneTemplateId)
  assert.equal("copiedTargetTemplateId" in review.template, false)
  assert.equal("copiedTargetName" in review.template, false)
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 0,
    scheduleDuration: "0 Days",
    scheduleItems: 0,
    selections: 2,
    bidPackages: 0,
  })
  assert.deepEqual(review.template.browserModuleGates, [
    {
      module: "selections",
      expectedCount: 2,
      capturedCount: 0,
      status: "pending",
      releaseBlocker: "Recover both selection native IDs, metadata, hierarchy, choices, choice ordering, descriptions, prices, attachment evidence, and any copy warnings from a supported Buildertrend view or export.",
    },
  ])
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("excludes the pending Stone checkpoint from release assembly", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(documents.some(({ source }) => source.includes("36-37180847")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === stoneTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === stoneTemplateId),
    false
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)

  const reviewedStone = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === stoneTemplateId
  )
  assert.ok(reviewedStone)
  assert.deepEqual(reviewedStone.moduleCounts, { selections: 2 })
  assert.equal(reviewedStone.scheduleDurationDays, 0)
  assert.equal(reviewedStone.schedule, null)
})
