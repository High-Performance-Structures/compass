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

test("preserves the exact partial Framing Quote Packages capture as a fail-closed audit", async () => {
  const review = await readJson(paths.review)

  assert.equal(review.reviewStatus, "incomplete")
  assert.equal(review.releaseEligible, false)
  assert.equal(review.template.sourceTemplateId, framingQuotesTemplateId)
  assert.equal(typeof review.template.capturedAt, "string")
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
      { module: "bidPackages", expectedCount: 3, capturedCount: 3, status: "incomplete" },
    ]
  )
  assert.equal(review.template.browserModuleGates[0].releaseBlocker.length > 0, true)
  assert.deepEqual(
    review.template.bidPackages.map((bidPackage) => [
      bidPackage.sourceBidPackageId,
      bidPackage.title,
      bidPackage.lineItems.length,
      bidPackage.plansAndSpecs,
    ]),
    [
      ["10393689", "Framing - (Project Address) (Estimate Phase)", 6, false],
      ["10393709", "Framing Pack - (Project Address) (Estimate Phase)", 6, false],
      ["10393691", "Truss Pack - (Project Address) (Estimate Phase)", 2, null],
    ]
  )
  assert.deepEqual(
    review.template.bidPackages.flatMap((bidPackage) =>
      bidPackage.lineItems.map((lineItem) => lineItem.sourceLineItemId)
    ),
    [
      "17932064",
      "17932065",
      "17932066",
      "17932067",
      "17932068",
      "17932069",
      "17932109",
      "17932110",
      "17932111",
      "17932112",
      "21064291",
      "17932115",
      "17932113",
      "17932114",
    ]
  )
  assert.equal(
    review.template.bidPackages.every(
      (bidPackage) =>
        bidPackage.status === "Draft" &&
        bidPackage.pricingFormat === "Line Items" &&
        bidPackage.allowMultipleApprovedBids === false &&
        bidPackage.attachments.length === 0 &&
        bidPackage.description.includes("Contract and Insurance Requirements")
    ),
    true
  )
  assert.equal(
    review.template.bidPackages.flatMap((bidPackage) => bidPackage.lineItems)
      .every((lineItem) => lineItem.description === null),
    true
  )
  assert.deepEqual(
    review.conversionExceptions.map((exception) => [
      exception.sourceItemId,
      exception.field,
    ]),
    [
      [null, "lineItems.description"],
      ["10393691", "plansAndSpecs"],
    ]
  )
})

test("excludes the incomplete Framing Quote Packages checkpoint from discovery and release", async () => {
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
