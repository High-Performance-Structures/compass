import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const mepQuotesTemplateId = "36595931"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/35-36595931.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("records MEP Quotes as a fail-closed pending browser capture", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "pending")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, mepQuotesTemplateId)
  assert.equal(review.template.sourceName, "MEP - Quotes")
  assert.equal(review.template.temporaryBuildertrendTargetName, "BT MEP - Quotes")
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 0,
    scheduleItems: 0,
    selections: 0,
    bidPackages: 3,
  })
  assert.deepEqual(
    review.template.browserModuleGates.map((gate) => ({
      module: gate.module,
      expectedCount: gate.expectedCount,
      capturedCount: gate.capturedCount,
      status: gate.status,
    })),
    [
      {
        module: "bidPackages",
        expectedCount: 3,
        capturedCount: 0,
        status: "pending",
      },
    ]
  )
  assert.equal(review.template.browserModuleGates[0].releaseBlocker.length > 0, true)
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("excludes the pending MEP Quotes audit from fragment discovery and release assembly", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === mepQuotesTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === mepQuotesTemplateId),
    false
  )

  const reviewedMepQuotes = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === mepQuotesTemplateId
  )
  assert.ok(reviewedMepQuotes)
  assert.deepEqual(reviewedMepQuotes.moduleCounts, { bidPackages: 3 })
  assert.equal(reviewedMepQuotes.schedule, null)
})
