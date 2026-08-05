import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const framingQuotesTemplateId = "36478698"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/34-36478698.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("keeps Framing Quote Packages fail closed while its three bid packages are pending", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "pending")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, framingQuotesTemplateId)
  assert.equal(review.template.capturedAt, null)
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
      { module: "bidPackages", expectedCount: 3, capturedCount: 0, status: "pending" },
    ]
  )
  assert.equal(review.template.browserModuleGates[0].releaseBlocker.length > 0, true)
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("excludes the pending Framing Quote Packages checkpoint from fragment discovery and release assembly", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === framingQuotesTemplateId),
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
      (template) => template.sourceTemplateId === framingQuotesTemplateId
    ),
    false
  )

  const manifestEntry = nextBatchManifest.templates.find(
    (template) => template.sourceTemplateId === framingQuotesTemplateId
  )
  assert.ok(manifestEntry)
  assert.equal(manifestEntry.workplanSequence, 34)
  assert.deepEqual(manifestEntry.moduleCounts, {
    tasks: 0,
    scheduleItems: 0,
    selections: 0,
    bidPackages: 3,
  })
  assert.deepEqual(manifestEntry.captureGates, {
    bidPackages: {
      expectedCount: 3,
      evidence: "browser_fragment_required",
    },
  })

  const reviewedTemplate = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === framingQuotesTemplateId
  )
  assert.ok(reviewedTemplate)
  assert.equal(reviewedTemplate.schedule, null)
  assert.deepEqual(reviewedTemplate.moduleCounts, { bidPackages: 3 })
})
