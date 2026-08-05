import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const interiorPaintingTemplateId = "36619183"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/31-36619183.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the Interior Painting/Staining capture queue as a fail-closed gate", async () => {
  const [review, manifest, reviewedCapture] = await Promise.all([
    readJson(paths.review),
    readJson(paths.manifest),
    readJson(paths.reviewed),
  ])

  assert.equal(review.reviewStatus, "pending")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, interiorPaintingTemplateId)
  assert.equal("copiedTargetTemplateId" in review.template, false)
  assert.equal("copiedTargetName" in review.template, false)
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 0,
    scheduleDuration: "0 Days",
    scheduleItems: 0,
    selections: 8,
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
      { module: "selections", expectedCount: 8, capturedCount: 0, status: "pending" },
      { module: "bidPackages", expectedCount: 1, capturedCount: 0, status: "pending" },
    ]
  )
  assert.equal(review.template.browserModuleGates.every((gate) => gate.releaseBlocker.length > 0), true)
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])

  const manifestEntry = manifest.templates.find(
    (template) => template.sourceTemplateId === interiorPaintingTemplateId
  )
  const reviewedEntry = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === interiorPaintingTemplateId
  )
  assert.ok(manifestEntry)
  assert.ok(reviewedEntry)
  assert.deepEqual(manifestEntry.moduleCounts, {
    tasks: 0,
    scheduleItems: 0,
    selections: 8,
    bidPackages: 1,
  })
  assert.deepEqual(reviewedEntry.moduleCounts, {
    bidPackages: 1,
    selections: 8,
  })
  assert.equal(reviewedEntry.schedule, null)
})

test("keeps pending Interior Painting/Staining evidence out of fragment discovery and release", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === interiorPaintingTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some(
      (template) => template.sourceTemplateId === interiorPaintingTemplateId
    ),
    false
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
  assert.equal(result.capture.assembly.templateCount, 10)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 24)
})
