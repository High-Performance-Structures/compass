import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const radonTemplateId = "42924180"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/37-42924180.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("records Radon Systems as a fail-closed pending bid-package capture", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "pending_browser_capture")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, radonTemplateId)
  assert.equal(review.template.sourceName, "Earthwork - Radon Systems")
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 0,
    scheduleItems: 0,
    selections: 0,
    bidPackages: 1,
  })
  assert.deepEqual(review.template.browserModuleGates, [
    {
      module: "bidPackages",
      expectedCount: 1,
      capturedCount: 0,
      status: "pending",
      releaseBlocker: "Recover the bid package native identity, status, specifications, line items, cost codes, Cost Types, quantities, units, linked plans and specifications, and any Buildertrend copy warnings from an authenticated supported view or export.",
    },
  ])
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("keeps the pending Radon Systems audit out of fragment discovery and release assembly", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === radonTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === radonTemplateId),
    false
  )

  const reviewedRadon = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === radonTemplateId
  )
  assert.ok(reviewedRadon)
  assert.equal(reviewedRadon.name, "Earthwork - Radon Systems")
  assert.deepEqual(reviewedRadon.moduleCounts, { bidPackages: 1 })
  assert.equal(reviewedRadon.scheduleDurationDays, 0)
  assert.equal(reviewedRadon.schedule, null)

  const manifestRadon = nextBatchManifest.templates.find(
    (template) => template.sourceTemplateId === radonTemplateId
  )
  assert.ok(manifestRadon)
  assert.equal(manifestRadon.workplanSequence, 37)
  assert.deepEqual(manifestRadon.moduleCounts, {
    tasks: 0,
    scheduleItems: 0,
    selections: 0,
    bidPackages: 1,
  })
  assert.deepEqual(manifestRadon.captureGates, {
    bidPackages: {
      expectedCount: 1,
      evidence: "browser_fragment_required",
    },
  })
})
