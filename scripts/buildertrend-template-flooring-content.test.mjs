import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const flooringTemplateId = "38452172"
const paths = {
  fragment: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/32-38452172.capture.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves Flooring selections, choices, and bid specifications", async () => {
  const fragment = await readJson(paths.fragment)

  assert.equal(fragment.template.sourceTemplateId, flooringTemplateId)
  assert.equal(fragment.template.sourceName, "Int. Finishes - Flooring")
  assert.equal(fragment.template.selections.length, 3)
  assert.deepEqual(
    fragment.template.selections.map((selection) => ({
      sourceSelectionId: selection.sourceSelectionId,
      title: selection.title,
      choiceCount: selection.choices.length,
      category: selection.category,
      location: selection.location,
      requireClientSelection: selection.requireClientSelection,
      allowMultipleSelectedChoices: selection.allowMultipleSelectedChoices,
      choiceOrdering: selection.choiceOrdering,
    })),
    [
      {
        sourceSelectionId: "53867143",
        title: "Flooring Type",
        choiceCount: 7,
        category: "09 60 00 - Flooring",
        location: "Unassigned",
        requireClientSelection: false,
        allowMultipleSelectedChoices: false,
        choiceOrdering: "Auto",
      },
      {
        sourceSelectionId: "53867162",
        title: "Stain Concrete Floors Wax Finish",
        choiceCount: 2,
        category: "09 60 00 - Flooring",
        location: "Unassigned",
        requireClientSelection: false,
        allowMultipleSelectedChoices: false,
        choiceOrdering: "Auto",
      },
      {
        sourceSelectionId: "53867154",
        title: "Stained Concrete Floor Color",
        choiceCount: 0,
        category: "09 60 00 - Flooring",
        location: "Unassigned",
        requireClientSelection: false,
        allowMultipleSelectedChoices: false,
        choiceOrdering: "Auto",
      },
    ]
  )

  const flooringType = fragment.template.selections[0]
  assert.deepEqual(
    flooringType.choices.map((choice) => ({
      sourceChoiceId: choice.sourceChoiceId,
      title: choice.title,
      description: choice.description,
      attachmentCount: choice.attachmentCount,
    })),
    [
      { sourceChoiceId: "211681334", title: "Carpet", description: "Visit the Arlun website for carpet styles.", attachmentCount: 1 },
      { sourceChoiceId: "211681333", title: "Hardwood (Engineered or Solid)", description: "Visit the Arlun website to view hardwood flooring options.", attachmentCount: 1 },
      { sourceChoiceId: "211681332", title: "Luxury Vinyl Tile and Plank", description: "Visit the Arlun website to see options for stone, tile and wood looks.", attachmentCount: 1 },
      { sourceChoiceId: "211682778", title: "Raw Concrete", description: "", attachmentCount: 1 },
      { sourceChoiceId: "211681330", title: "Stained Concrete", description: "", attachmentCount: 1 },
      { sourceChoiceId: "211681331", title: "Stamped and Stained Concrete", description: "Visit the proinestamps website to see sample stamp patterns.", attachmentCount: 1 },
      { sourceChoiceId: "211681329", title: "Tile", description: "Please visit the Arlun website to view tile styles.", attachmentCount: 1 },
    ]
  )
  assert.deepEqual(
    fragment.template.selections[1].choices.map((choice) => ({
      sourceChoiceId: choice.sourceChoiceId,
      title: choice.title,
      description: choice.description,
      attachmentCount: choice.attachmentCount,
    })),
    [
      { sourceChoiceId: "211681416", title: "Gloss Finish", description: "Reflective floor finish", attachmentCount: 0 },
      { sourceChoiceId: "211681403", title: "Matte Finish", description: "Unreflective concrete finish", attachmentCount: 0 },
    ]
  )
  assert.match(fragment.template.selections[2].description, /prosoco\.com\/product\/gemtone-stain/)

  assert.equal(fragment.template.bidPackages.length, 1)
  const bid = fragment.template.bidPackages[0]
  assert.equal(bid.sourceBidPackageId, "11233112")
  assert.equal(bid.title, "Flooring - (Proj. St Address) (Estimate Phase)")
  assert.equal(bid.status, "Draft")
  assert.equal(bid.allowMultipleApprovedBids, false)
  assert.equal(bid.reminderLeadDays, 5)
  assert.equal(bid.plansAndSpecs, false)
  assert.equal(bid.linkedPlanCount, 0)
  assert.equal(bid.linkedSpecCount, 0)
  assert.deepEqual(bid.attachments, [])
  assert.match(bid.description, /Contract and Insurance Requirements/)
  assert.match(bid.internalNotes, /remove undesired options/)
  assert.deepEqual(
    bid.lineItems.map((lineItem) => ({
      sourceLineItemId: lineItem.sourceLineItemId,
      title: lineItem.title,
      costCode: lineItem.costCode,
      costType: lineItem.costType,
      quantity: lineItem.quantity,
      unit: lineItem.unit,
    })),
    [
      { sourceLineItemId: "19487649", title: "Tile Flooring Installation Labor & Materials", costCode: "09 30 00 - Tiling", costType: "Subcontractor", quantity: 1, unit: null },
      { sourceLineItemId: "19487650", title: "Hardwood Flooring Installation Labor & Materials", costCode: "09 64 00 - Wood Flooring", costType: "Subcontractor", quantity: 1, unit: null },
      { sourceLineItemId: "19487651", title: "Carpet Installation Labor & Materials", costCode: "09 64 00 - Wood Flooring", costType: "Subcontractor", quantity: 1, unit: null },
      { sourceLineItemId: "19487652", title: "Vinyl Flooring Installation Labor & Materials", costCode: "09 65 00 - Resilient Flooring", costType: "Subcontractor", quantity: 1, unit: null },
      { sourceLineItemId: "19487653", title: "LVP/T Flooring Installation Labor & Materials", costCode: "09 68 00 - Carpeting", costType: "Subcontractor", quantity: 1, unit: null },
    ]
  )
  assert.equal(bid.lineItems.every((lineItem) => lineItem.description.length > 0), true)

  assert.equal(fragment.conversionExceptions.length, 1)
  assert.deepEqual(fragment.conversionExceptions[0], {
    templateSourceTemplateId: flooringTemplateId,
    module: "selections",
    sourceItemId: "53867143",
    field: "choices.attachments.fileName",
    sourceValue: "Each of the seven Flooring Type choices displayed one attachment, but the bounded authenticated source capture did not expose any attachment filename.",
    loss: "Seven attachment filenames and durable attachment bytes were unavailable and were omitted; the verified attachmentCount remains one on every Flooring Type choice.",
    recoveryPlan: "Recover the seven exact filenames and attachment bytes from a supported Buildertrend export or a later authenticated detail capture before publishing this draft; do not derive filenames from choice titles.",
  })
})

test("includes the gate-complete Flooring fragment in draft-only release assembly", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(release.scope.structurallyCompleteTemplatesIncluded, 22)
  assert.equal(release.scope.incompleteTemplatesExcluded, 12)
  assert.equal(
    release.templates.some((template) =>
      template.sourceTemplateId === flooringTemplateId &&
      template.fragmentPath === paths.fragment &&
      template.browserCaptureGates === "complete"
    ),
    true
  )

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  const flooring = result.capture.templates.find(
    (template) => template.sourceTemplateId === flooringTemplateId
  )
  assert.ok(flooring)
  assert.equal(flooring.tasks.length, 0)
  assert.equal(flooring.scheduleItems.length, 0)
  assert.equal(flooring.selections.length, 3)
  assert.equal(flooring.bidPackages.length, 1)
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 12)
})
