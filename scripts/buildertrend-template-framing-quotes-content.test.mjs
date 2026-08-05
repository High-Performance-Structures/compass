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
  fragment: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/34-36478698.capture.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the exact Framing Quote Packages content", async () => {
  const fragment = await readJson(paths.fragment)

  assert.equal(fragment.sourceTemplateId, framingQuotesTemplateId)
  assert.equal(fragment.sourceName, "Framing - Quote Packages")
  assert.equal(typeof fragment.capturedAt, "string")
  assert.deepEqual(
    fragment.bidPackages.map((bidPackage) => [
      bidPackage.sourceBidPackageId,
      bidPackage.title,
      bidPackage.lineItems.length,
      bidPackage.plansAndSpecs,
    ]),
    [
      ["10393689", "Framing - (Project Address) (Estimate Phase)", 6, false],
      ["10393709", "Framing Pack - (Project Address) (Estimate Phase)", 6, false],
      ["10393691", "Truss Pack - (Project Address) (Estimate Phase)", 2, false],
    ]
  )
  assert.equal(
    fragment.bidPackages.every(
      (bidPackage) =>
        bidPackage.status === "Draft" &&
        bidPackage.pricingFormat === "Line Items" &&
        bidPackage.allowMultipleApprovedBids === false &&
        bidPackage.attachments.length === 0 &&
        bidPackage.description.includes("Contract and Insurance Requirements")
    ),
    true
  )

  assert.deepEqual(
    fragment.bidPackages.flatMap((bidPackage) =>
      bidPackage.lineItems.map((lineItem) => [
        lineItem.sourceLineItemId,
        lineItem.description,
      ])
    ),
    [
      ["17932064", "Please provide all necessary labor and installation miscellaneous materials (such as fasteners) for the interior wall framing assemblies."],
      ["17932065", "Please include all necessary labor & miscellaneous materials (such as fasteners, etc) for all exterior deck framing assemblies."],
      ["17932066", "Please include all necessary labor & miscellaneous installation materials (such as fasteners, etc.) for the framing of all floor assemblies."],
      ["17932067", "Please include all necessary roof framing labor & miscellaneous installation materials (such as fasteners, etc). for framing of all roof assemblies."],
      ["17932068", "Please include all necessary labor & miscellaneous installation materials (such as fasteners, shims, etc.) for the installation of all exterior doors."],
      ["17932069", "Please include all necessary labor & fasteners for the installation of all windows."],
      ["17932109", "Please include all necessary materials including backout for the interior and exterior wall framing."],
      ["17932110", "Please include all necessary materials for the framing of the exterior deck. Please exclude decking and see the line below for decking materials."],
      ["17932111", "Please include all necessary framing materials to frame the interior floor system."],
      ["17932112", "Roof Framing Materials See Breakout Attachment"],
      ["21064291", "Please include all necessary materials for soffit & fascia. Please include (Grade, ie. Hardie, LP) materials."],
      ["17932115", "Please include the cost of delivery per trip."],
      ["17932113", ""],
      ["17932114", ""],
    ]
  )
  assert.equal(
    fragment.bidPackages.flatMap((bidPackage) => bidPackage.lineItems)
      .every((lineItem) => lineItem.description !== null),
    true
  )
})

test("includes Framing Quote Packages in the complete draft-only release", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  const releaseEntry = release.templates.find(
    (template) => template.sourceTemplateId === framingQuotesTemplateId
  )
  assert.ok(releaseEntry)
  assert.equal(releaseEntry.workplanSequence, 34)
  assert.deepEqual(releaseEntry.moduleCounts, {
    tasks: 0,
    scheduleItems: 0,
    selections: 0,
    bidPackages: 3,
  })
  assert.equal(releaseEntry.fragmentPath, paths.fragment)
  assert.equal(releaseEntry.browserCaptureGates, "complete")

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  const template = result.capture.templates.find(
    (item) => item.sourceTemplateId === framingQuotesTemplateId
  )
  assert.ok(template)
  assert.equal(template.tasks.length, 0)
  assert.equal(template.scheduleItems.length, 0)
  assert.equal(template.selections.length, 0)
  assert.equal(template.bidPackages.length, 3)
  assert.equal(result.capture.assembly.templateCount, 24)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 10)
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)

  const reviewedTemplate = reviewedCapture.templates.find(
    (item) => item.sourceTemplateId === framingQuotesTemplateId
  )
  assert.ok(reviewedTemplate)
  assert.equal(reviewedTemplate.schedule, null)
  assert.deepEqual(reviewedTemplate.moduleCounts, { bidPackages: 3 })
})
