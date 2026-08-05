import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const stainConcreteTemplateId = "12979213"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/28-12979213.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the Stain & Seal Concrete Floors capture gate without inventing browser evidence", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, stainConcreteTemplateId)
  assert.equal("copiedTargetTemplateId" in review.template, false)
  assert.equal("copiedTargetName" in review.template, false)
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 7,
    scheduleDuration: "7 Days",
    scheduleItems: 5,
    selections: 0,
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
      { module: "tasks", expectedCount: 7, capturedCount: 0, status: "incomplete" },
    ]
  )
  assert.equal(review.template.browserModuleGates.every((gate) => gate.releaseBlocker.length > 0), true)
  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.selections, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.deepEqual(review.conversionExceptions, [])
})

test("keeps incomplete Stain & Seal Concrete Floors out of release and preserves canonical schedule truth", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === stainConcreteTemplateId),
    false
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(
    result.capture.templates.some((template) => template.sourceTemplateId === stainConcreteTemplateId),
    false
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)

  const reviewedStainConcrete = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === stainConcreteTemplateId
  )
  assert.ok(reviewedStainConcrete)
  assert.deepEqual(
    reviewedStainConcrete.schedule.items.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "145114223",
        title: "Prep Floors",
        startDate: "2022-05-23",
        workdays: 1,
        phase: "Interior Finish",
        displayColor: "#008000",
      },
      {
        sourceItemId: "145114248",
        title: "Stain Floors",
        startDate: "2022-05-24",
        workdays: 1,
        phase: "Interior Finish",
        displayColor: "#008000",
      },
      {
        sourceItemId: "145114252",
        title: "Seal Floors",
        startDate: "2022-05-25",
        workdays: 3,
        phase: "Interior Finish",
        displayColor: "#008000",
      },
      {
        sourceItemId: "145114287",
        title: "HPS Concrete Stain & Seal QC Inspection",
        startDate: "2022-05-30",
        workdays: 1,
        phase: "Interior Finish",
        displayColor: "#2222DD",
      },
      {
        sourceItemId: "145114260",
        title: "Cover Floors",
        startDate: "2022-05-31",
        workdays: 1,
        phase: "Interior Finish",
        displayColor: "#008000",
      },
    ]
  )
  assert.deepEqual(reviewedStainConcrete.schedule.dependencies, [
    {
      predecessorSourceItemId: "145114223",
      successorSourceItemId: "145114248",
      type: "FS",
      lagDays: 0,
    },
    {
      predecessorSourceItemId: "145114248",
      successorSourceItemId: "145114252",
      type: "FS",
      lagDays: 0,
    },
    {
      predecessorSourceItemId: "145114252",
      successorSourceItemId: "145114287",
      type: "FS",
      lagDays: 0,
    },
    {
      predecessorSourceItemId: "145114252",
      successorSourceItemId: "145114260",
      type: "FS",
      lagDays: 1,
    },
  ])
})
