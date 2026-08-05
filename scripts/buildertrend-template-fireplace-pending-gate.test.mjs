import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const fireplaceTemplateId = "38452532"
const expectedFragmentPath =
  "scripts/fixtures/buildertrend-template-content-next-batch/fragments/40-38452532.capture.json"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/40-38452532.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
  workplan: "scripts/fixtures/buildertrend-template-capture-workplan-2026-08-03.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("keeps Fireplace Installation behind its exact one-selection capture gate", async () => {
  const [nextBatchManifest, workplan, reviewedCapture] = await Promise.all([
    readJson(paths.manifest),
    readJson(paths.workplan),
    readJson(paths.reviewed),
  ])

  const workplanTemplate = workplan.templates.find(
    (template) => template.sourceTemplateId === fireplaceTemplateId
  )
  assert.ok(workplanTemplate)
  assert.deepEqual(workplanTemplate, {
    sequence: 40,
    batchId: "batch-03",
    sourceTemplateId: fireplaceTemplateId,
    sourceName: "MEP - Fireplace Installation",
    sourceUrl: "https://buildertrend.net/app/Templates/MyTemplates/Template/38452532",
    temporaryBuildertrendTargetName: "BT MEP - Fireplace Installation",
    moduleCounts: {
      selections: 1,
    },
    totalWorkItems: 1,
    status: "pending",
    exceptions: [],
  })

  const manifestTemplate = nextBatchManifest.templates.find(
    (template) => template.sourceTemplateId === fireplaceTemplateId
  )
  assert.ok(manifestTemplate)
  assert.equal(manifestTemplate.captureOrder, 34)
  assert.equal(manifestTemplate.workplanSequence, 40)
  assert.equal(manifestTemplate.workplanStatus, "pending")
  assert.equal(manifestTemplate.fragmentPath, expectedFragmentPath)
  assert.deepEqual(manifestTemplate.moduleCounts, {
    tasks: 0,
    scheduleItems: 0,
    selections: 1,
    bidPackages: 0,
  })
  assert.deepEqual(manifestTemplate.captureGates, {
    selections: {
      expectedCount: 1,
      evidence: "browser_fragment_required",
    },
  })

  const reviewedTemplate = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === fireplaceTemplateId
  )
  assert.ok(reviewedTemplate)
  assert.equal(reviewedTemplate.name, "MEP - Fireplace Installation")
  assert.deepEqual(reviewedTemplate.moduleCounts, { selections: 1 })
  assert.equal(reviewedTemplate.schedule, null)
})

test("preserves the authenticated Fireplace Installation checkpoint as a fail-closed audit", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, fireplaceTemplateId)
  assert.equal(review.template.capturedAt, "2026-08-05T10:47:09Z")
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 0,
    scheduleDuration: "0 Days",
    scheduleItems: 0,
    selections: 1,
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
      { module: "selections", expectedCount: 1, capturedCount: 0, status: "incomplete" },
    ]
  )
  assert.equal(review.template.browserModuleGates[0].releaseBlocker.length > 0, true)
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("excludes incomplete Fireplace Installation content from fragment discovery and release assembly", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(
    documents.some(({ source }) => source.endsWith("40-38452532.capture.json")),
    false
  )
  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some(
      (template) => template.sourceTemplateId === fireplaceTemplateId
    ),
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
      (template) => template.sourceTemplateId === fireplaceTemplateId
    ),
    false
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
  assert.equal(result.capture.assembly.templateCount, 10)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 24)
})
