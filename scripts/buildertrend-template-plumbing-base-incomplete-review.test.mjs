import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const plumbingBaseTemplateId = "12650395"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/25-12650395.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the authenticated Plumbing Base checkpoint without inventing module evidence", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, plumbingBaseTemplateId)
  assert.equal(review.template.capturedAt, "2026-08-05T06:33:51Z")
  assert.equal("preparedAt" in review.template, false)
  assert.equal("copiedTargetTemplateId" in review.template, false)
  assert.equal("copiedTargetName" in review.template, false)
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 9,
    scheduleDuration: "6 Days",
    scheduleItems: 4,
    selections: 0,
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
      { module: "tasks", expectedCount: 9, capturedCount: 0, status: "incomplete" },
      { module: "bidPackages", expectedCount: 1, capturedCount: 0, status: "incomplete" },
    ]
  )
  assert.equal(review.template.browserModuleGates.every((gate) => gate.releaseBlocker.length > 0), true)
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
  assert.equal(
    review.template.captureNotes.some((note) => note.includes("JobPickerActions")),
    true
  )
})

test("keeps incomplete Plumbing Base out of release and preserves canonical schedule truth", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === plumbingBaseTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === plumbingBaseTemplateId),
    false
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)

  const reviewedPlumbingBase = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === plumbingBaseTemplateId
  )
  assert.ok(reviewedPlumbingBase)
  assert.deepEqual(
    reviewedPlumbingBase.schedule.items.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "141691196",
        title: "Plumbing Base",
        startDate: "2022-04-13",
        workdays: 4,
        phase: "Base Infrastructure",
        displayColor: "#436A8C",
      },
      {
        sourceItemId: "141694381",
        title: "Water Line Tie-In",
        startDate: "2022-04-13",
        workdays: 1,
        phase: "Base Infrastructure",
        displayColor: "#436A8C",
      },
      {
        sourceItemId: "141691568",
        title: "HPS Plumbing Base QC Inspection",
        startDate: "2022-04-19",
        workdays: 1,
        phase: "Base Infrastructure",
        displayColor: "#2222DD",
      },
      {
        sourceItemId: "141691620",
        title: "Building Department Plumbing Base Inspection",
        startDate: "2022-04-20",
        workdays: 1,
        phase: "Base Infrastructure",
        displayColor: "#ED2591",
      },
    ]
  )
  assert.deepEqual(reviewedPlumbingBase.schedule.dependencies, [
    {
      predecessorSourceItemId: "141691196",
      successorSourceItemId: "141694381",
      type: "SS",
      lagDays: 0,
    },
    {
      predecessorSourceItemId: "141691196",
      successorSourceItemId: "141691568",
      type: "FS",
      lagDays: 0,
    },
    {
      predecessorSourceItemId: "141691568",
      successorSourceItemId: "141691620",
      type: "FS",
      lagDays: 0,
    },
  ])
})
