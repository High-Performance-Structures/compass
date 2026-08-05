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

test("preserves the bounded MEP Quotes capture as a fail-closed audit", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
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
        capturedCount: 1,
        status: "incomplete",
      },
    ]
  )
  assert.equal(review.template.browserModuleGates[0].releaseBlocker.length > 0, true)
  assert.deepEqual(review.template.packageIndex, [
    {
      sourceBidPackageId: "10427367",
      title: "Electrical - (Project Address) (Estimate Phase)",
      detailStatus: "captured",
    },
    {
      sourceBidPackageId: "10427813",
      title: "HVAC - (Project Address) (Estimate Phase)",
      detailStatus: "incomplete",
    },
    {
      sourceBidPackageId: "10427674",
      title: "Plumbing - (Project Address) (Estimate Phase)",
      detailStatus: "incomplete",
    },
  ])
  assert.equal(review.template.bidPackages.length, 1)
  const [electrical] = review.template.bidPackages
  assert.equal(electrical.sourceBidPackageId, "10427367")
  assert.equal(electrical.title, "Electrical - (Project Address) (Estimate Phase)")
  assert.equal(electrical.status, "Draft")
  assert.equal(electrical.allowMultipleApprovedBids, false)
  assert.equal(electrical.deadline, null)
  assert.equal(electrical.time, null)
  assert.equal(electrical.reminderLeadDays, 2)
  assert.equal(electrical.plansAndSpecs, false)
  assert.equal(electrical.linkedPlanCount, 0)
  assert.equal(electrical.linkedSpecCount, 0)
  assert.equal(electrical.pricingFormat, "Line Items")
  assert.equal(electrical.internalNotes, "")
  assert.deepEqual(electrical.attachments, [])
  assert.match(electrical.description, /Contract and Insurance Requirements/)
  assert.deepEqual(
    electrical.lineItems.map((line) => [
      line.sourceLineItemId,
      line.title,
      line.costCode,
      line.costType,
      line.quantity,
      line.unit,
    ]),
    [
      ["17993185", "Temporary Electricity Labor & Materials", "01 51 13 - Temp Electricity", "Subcontractor", 1, null],
      ["17993186", "Electrical Rough Labor & Materials", "26 00 00 - Electrical", "Subcontractor", 1, null],
      ["17993574", "Electrical Trim & Fixtures Installation Labor & Materials", "26 00 00 - Electrical", "Subcontractor", 1, null],
      ["17993187", "Under Cabinet Lighting Budgetary Option Labor & Materials", "26 00 00 - Electrical", "Subcontractor", 1, null],
      ["17993188", "Low-Volt Electrical Labor & Materials", "27 10 00 - Structured Cabling", "Subcontractor", 1, null],
      ["17993423", "Electrical Underground Labor & Materials", "33 71 19 - Elec Underground", "Subcontractor", 1, null],
    ]
  )
  assert.equal(electrical.lineItems.every((line) => line.description.length > 0), true)
  assert.deepEqual(review.conversionExceptions, [])
})

test("excludes the incomplete MEP Quotes audit from fragment discovery and release assembly", async () => {
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
