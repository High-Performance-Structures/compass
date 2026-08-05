import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const insulationTemplateId = "39644707"
const expectedFragmentPath =
  "scripts/fixtures/buildertrend-template-content-next-batch/fragments/38-39644707.capture.json"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/38-39644707.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
  workplan: "scripts/fixtures/buildertrend-template-capture-workplan-2026-08-03.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the exact Insulation checkpoint behind its one-bid-package capture gate", async () => {
  const [nextBatchManifest, workplan, reviewedCapture, review] = await Promise.all([
    readJson(paths.manifest),
    readJson(paths.workplan),
    readJson(paths.reviewed),
    readJson(paths.review),
  ])

  const workplanTemplate = workplan.templates.find(
    (template) => template.sourceTemplateId === insulationTemplateId
  )
  assert.ok(workplanTemplate)
  assert.deepEqual(workplanTemplate, {
    sequence: 38,
    batchId: "batch-03",
    sourceTemplateId: insulationTemplateId,
    sourceName: "Insulation",
    sourceUrl: "https://buildertrend.net/app/Templates/MyTemplates/Template/39644707",
    temporaryBuildertrendTargetName: "BT Insulation",
    moduleCounts: {
      bidPackages: 1,
    },
    totalWorkItems: 1,
    status: "pending",
    exceptions: [],
  })

  const manifestTemplate = nextBatchManifest.templates.find(
    (template) => template.sourceTemplateId === insulationTemplateId
  )
  assert.ok(manifestTemplate)
  assert.equal(manifestTemplate.captureOrder, 32)
  assert.equal(manifestTemplate.workplanSequence, 38)
  assert.equal(manifestTemplate.workplanStatus, "pending")
  assert.equal(manifestTemplate.fragmentPath, expectedFragmentPath)
  assert.deepEqual(manifestTemplate.moduleCounts, {
    tasks: 0,
    scheduleItems: 0,
    selections: 0,
    bidPackages: 1,
  })
  assert.deepEqual(manifestTemplate.captureGates, {
    bidPackages: {
      expectedCount: 1,
      evidence: "browser_fragment_required",
    },
  })

  const reviewedTemplate = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === insulationTemplateId
  )
  assert.ok(reviewedTemplate)
  assert.equal(reviewedTemplate.name, "Insulation")
  assert.deepEqual(reviewedTemplate.moduleCounts, { bidPackages: 1 })
  assert.equal(reviewedTemplate.schedule, null)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, insulationTemplateId)
  assert.equal("copiedTargetTemplateId" in review.template, false)
  assert.equal("copiedTargetName" in review.template, false)
  assert.deepEqual(review.template.sourceInventory, {
    scheduleDuration: "0 Days",
    scheduleItems: 0,
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
      {
        module: "bidPackages",
        expectedCount: 1,
        capturedCount: 0,
        status: "incomplete",
      },
    ]
  )
  assert.equal(review.template.browserModuleGates[0].releaseBlocker.length > 0, true)
  assert.deepEqual(review.template.reviewedScheduleReference, {
    path: paths.reviewed,
    sourceTemplateId: insulationTemplateId,
    scheduleItemCount: 0,
    dependencyCount: 0,
    note: "The reviewed source capture records schedule=null; browser fragments must not invent schedule rows.",
  })
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("excludes pending Insulation content from fragment discovery and release assembly", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(
    documents.some(({ source }) => source.endsWith("38-39644707.capture.json")),
    false
  )
  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some(
      (template) => template.sourceTemplateId === insulationTemplateId
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
      (template) => template.sourceTemplateId === insulationTemplateId
    ),
    false
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
  assert.equal(result.capture.assembly.templateCount, 22)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 12)
})
