import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const templateId = "30919251"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/23-30919251.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("keeps the Overhead Door capture plan fail closed until browser gates are complete", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "pending_browser_capture")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, templateId)
  assert.equal(review.template.sourceName, "Framing - Overhead Door Installation")
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 13,
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
      { module: "tasks", expectedCount: 13, capturedCount: 0, status: "pending" },
      { module: "selections", expectedCount: 1, capturedCount: 0, status: "pending" },
      { module: "bidPackages", expectedCount: 1, capturedCount: 0, status: "pending" },
    ]
  )
  assert.equal(review.template.browserModuleGates.every((gate) => gate.releaseBlocker.length > 0), true)
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("keeps the pending Overhead Door plan out of discovery and preserves schedule truth", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(release.templates.some((template) => template.sourceTemplateId === templateId), false)

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(result.capture.templates.some((template) => template.sourceTemplateId === templateId), false)

  const reviewedTemplate = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === templateId
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
        sourceItemId: "180251869",
        title: "Overhead Door Installation",
        startDate: "2023-08-23",
        workdays: 2,
        phase: "Rough: Frame",
        displayColor: "#E39D6C",
      },
      {
        sourceItemId: "180251891",
        title: "HPS Overhead Door QC Inspection",
        startDate: "2023-08-25",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#2222DD",
      },
    ]
  )
  assert.deepEqual(reviewedTemplate.schedule.dependencies, [
    {
      predecessorSourceItemId: "180251869",
      successorSourceItemId: "180251891",
      type: "FS",
      lagDays: 0,
    },
  ])
})
