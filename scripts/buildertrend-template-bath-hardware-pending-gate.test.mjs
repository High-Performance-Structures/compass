import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const bathHardwareTemplateId = "42948499"
const expectedFragmentPath =
  "scripts/fixtures/buildertrend-template-content-next-batch/fragments/39-42948499.capture.json"
const paths = {
  review: "scripts/fixtures/buildertrend-template-content-next-batch/incomplete-reviews/39-42948499.capture-review.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
  workplan: "scripts/fixtures/buildertrend-template-capture-workplan-2026-08-03.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("keeps Bath Hardware behind its exact one-selection capture gate", async () => {
  const [nextBatchManifest, workplan, reviewedCapture] = await Promise.all([
    readJson(paths.manifest),
    readJson(paths.workplan),
    readJson(paths.reviewed),
  ])

  const workplanTemplate = workplan.templates.find(
    (template) => template.sourceTemplateId === bathHardwareTemplateId
  )
  assert.ok(workplanTemplate)
  assert.deepEqual(workplanTemplate, {
    sequence: 39,
    batchId: "batch-03",
    sourceTemplateId: bathHardwareTemplateId,
    sourceName: "Int. Finishes - Bath Hardware",
    sourceUrl: "https://buildertrend.net/app/Templates/MyTemplates/Template/42948499",
    temporaryBuildertrendTargetName: "BT Int. Finishes - Bath Hardware",
    moduleCounts: {
      selections: 1,
    },
    totalWorkItems: 1,
    status: "pending",
    exceptions: [],
  })

  const manifestTemplate = nextBatchManifest.templates.find(
    (template) => template.sourceTemplateId === bathHardwareTemplateId
  )
  assert.ok(manifestTemplate)
  assert.equal(manifestTemplate.captureOrder, 33)
  assert.equal(manifestTemplate.workplanSequence, 39)
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
    (template) => template.sourceTemplateId === bathHardwareTemplateId
  )
  assert.ok(reviewedTemplate)
  assert.equal(reviewedTemplate.name, "Int. Finishes - Bath Hardware")
  assert.deepEqual(reviewedTemplate.moduleCounts, { selections: 1 })
  assert.equal(reviewedTemplate.schedule, null)
})

test("preserves the authenticated Bath Hardware checkpoint without inventing missing selection metadata", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, bathHardwareTemplateId)
  assert.deepEqual(review.template.sourceInventory, {
    tasks: 0,
    scheduleItems: 0,
    selections: 1,
    bidPackages: 0,
  })
  assert.deepEqual(review.template.browserModuleGates, [
    {
      module: "selections",
      expectedCount: 1,
      capturedCount: 1,
      releaseReadyCount: 0,
      status: "incomplete",
      releaseBlocker: "Recover or verify the exact selection public instructions and internal notes, each choice description, all six indicated attachment filenames, and durable attachment bytes before moving this audit into the active fragments directory.",
    },
  ])

  assert.deepEqual(review.template.tasks, [])
  assert.deepEqual(review.template.bidPackages, [])
  assert.equal(review.template.selections.length, 1)
  assert.deepEqual(review.template.selections[0], {
    sourceItemId: "59585706",
    sourceSelectionId: "59585706",
    title: "Bathroom Add Ons",
    category: "10 00 00 - Specialties",
    location: "Powder Room",
    status: "Unreleased",
    allowance: 0,
    deadline: null,
    requireClientSelection: false,
    allowMultipleSelectedChoices: true,
    choiceOrdering: "Manual",
    choices: [
      { sourceChoiceId: "240860708", title: "Bathroom Mirror", status: "Unreleased", price: 0, attachmentCount: 1 },
      { sourceChoiceId: "240860706", title: "Recessed Medicine Cabinet With Mirror", status: "Unreleased", price: 0, attachmentCount: 1 },
      { sourceChoiceId: "240860707", title: "Recessed Medicine Cabinet Without Mirror", status: "Unreleased", price: 0, attachmentCount: 1 },
      { sourceChoiceId: "240860704", title: "Single towel Bar", status: "Unreleased", price: 0, attachmentCount: 1 },
      { sourceChoiceId: "240860705", title: "Two Towel Bars", status: "Unreleased", price: 0, attachmentCount: 1 },
      { sourceChoiceId: "240860709", title: "Toilet Paper Holder", status: "Unreleased", price: 0, attachmentCount: 1 },
      { sourceChoiceId: "240860710", title: "None - Owner Scope", status: "Unreleased", price: 0, attachmentCount: 0 },
    ],
  })
  assert.equal(review.conversionExceptions.length, 3)
  assert.equal(
    review.conversionExceptions.every(
      (exception) =>
        exception.templateSourceTemplateId === bathHardwareTemplateId &&
        exception.module === "selections" &&
        exception.sourceItemId === "59585706" &&
        /do not infer|do not derive/.test(exception.recoveryPlan)
    ),
    true
  )
})

test("excludes pending Bath Hardware content from fragment discovery and release assembly", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(
    documents.some(({ source }) => source.endsWith("39-42948499.capture.json")),
    false
  )
  assert.equal(
    release.templates.some(
      (template) => template.sourceTemplateId === bathHardwareTemplateId
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
      (template) => template.sourceTemplateId === bathHardwareTemplateId
    ),
    false
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
  assert.equal(result.capture.assembly.templateCount, 21)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 13)
})
