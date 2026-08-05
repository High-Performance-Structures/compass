import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { readPilotContentFragments } from "./lib/buildertrend-template-content-pilot.mjs"
import { assembleBuildertrendTemplateNextBatchContent } from "./lib/buildertrend-template-next-batch-content.mjs"

const templateId = "36595931"
const paths = {
  fragment: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/35-36595931.capture.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves all three exact MEP quote packages", async () => {
  const fragment = await readJson(paths.fragment)
  assert.equal(fragment.sourceTemplateId, templateId)
  assert.equal(fragment.sourceName, "MEP - Quotes")
  assert.deepEqual(
    fragment.bidPackages.map((item) => [item.sourceBidPackageId, item.title, item.lineItems.length]),
    [
      ["10427367", "Electrical - (Project Address) (Estimate Phase)", 6],
      ["10427813", "HVAC - (Project Address) (Estimate Phase)", 9],
      ["10427674", "Plumbing - (Project Address) (Estimate Phase)", 3],
    ]
  )
  assert.equal(fragment.bidPackages.every((item) => item.status === "Draft"), true)
  assert.equal(fragment.bidPackages.every((item) => item.pricingFormat === "Line Items"), true)
  assert.equal(fragment.bidPackages.every((item) => item.allowMultipleApprovedBids === false), true)
  assert.equal(fragment.bidPackages.every((item) => item.linkToSchedule === false), true)
  assert.equal(fragment.bidPackages.every((item) => item.plansAndSpecs === false), true)
  assert.equal(fragment.bidPackages.every((item) => item.linkedPlanCount === 0), true)
  assert.equal(fragment.bidPackages.every((item) => item.linkedSpecCount === 0), true)
  assert.equal(fragment.bidPackages.every((item) => item.attachments.length === 0), true)
  assert.equal(fragment.bidPackages.flatMap((item) => item.lineItems).length, 18)
  assert.equal(fragment.bidPackages.flatMap((item) => item.lineItems).every((line) => line.unit === null), true)
  assert.deepEqual(
    fragment.bidPackages[2].lineItems.map((line) => [line.sourceLineItemId, line.title, line.costCode, line.costType, line.quantity, line.unit]),
    [
      ["17993676", "Base Plumbing Labor & Materials", "22 00 00 - Plumbing", "Subcontractor", 1, null],
      ["17993677", "Rough & Top-Out Plumbing Labor & Materials", "22 00 00 - Plumbing", "Subcontractor", 1, null],
      ["17993678", "Trim Plumbing & Fixture Installation Labor & Materials", "22 00 00 - Plumbing", "Subcontractor", 1, null],
    ]
  )
})

test("includes MEP Quotes in the complete draft-only release", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])
  const releaseEntry = release.templates.find((item) => item.sourceTemplateId === templateId)
  assert.ok(releaseEntry)
  assert.equal(releaseEntry.workplanSequence, 35)
  assert.deepEqual(releaseEntry.moduleCounts, { tasks: 0, scheduleItems: 0, selections: 0, bidPackages: 3 })
  assert.equal(releaseEntry.fragmentPath, paths.fragment)
  assert.equal(releaseEntry.browserCaptureGates, "complete")

  const result = assembleBuildertrendTemplateNextBatchContent({ release, nextBatchManifest, reviewedCapture, documents })
  const template = result.capture.templates.find((item) => item.sourceTemplateId === templateId)
  assert.ok(template)
  assert.equal(template.bidPackages.length, 3)
  assert.equal(result.capture.assembly.templateCount, 24)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 10)
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
})
