import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const interiorPaintingTemplateId = "36619183"
const paths = {
  fragment: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/31-36619183.capture.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves all Interior Painting selections, choices, and metadata", async () => {
  const fragment = await readJson(paths.fragment)
  const template = fragment.template

  assert.equal(template.sourceTemplateId, interiorPaintingTemplateId)
  assert.deepEqual(template.tasks, [])
  assert.deepEqual(
    template.selections.map((selection) => ({
      id: selection.sourceSelectionId,
      title: selection.title,
      location: selection.location,
      choiceCount: selection.choices.length,
      ordering: selection.choiceOrdering,
      locked: selection.locked,
    })),
    [
      { id: "58364152", title: "Paint Color", location: "Interior", choiceCount: 0, ordering: "Auto", locked: true },
      { id: "58363712", title: "Quantity of Colors", location: "Interior", choiceCount: 4, ordering: "Manual", locked: false },
      { id: "58364611", title: "Schedule a Meeting with Your Project Manager", location: "Unassigned", choiceCount: 1, ordering: "Auto", locked: true },
      { id: "58364544", title: "Three-Color: Ceilings", location: "Ceiling Throughout", choiceCount: 0, ordering: "Auto", locked: true },
      { id: "58364599", title: "Three-Color: Paint-Grade Baseboards, Doors & Trim", location: "Paint-Grade Doors, Baseboards & Trim", choiceCount: 0, ordering: "Auto", locked: true },
      { id: "58364335", title: "Three-Color: Walls", location: "Interior Walls Throughout", choiceCount: 0, ordering: "Auto", locked: true },
      { id: "58364298", title: "Two-Color: Paint Grade Baseboards, Doors & Trim", location: "Interior Base Boards, Doors & Trim", choiceCount: 0, ordering: "Auto", locked: true },
      { id: "58364165", title: "Two-Color: Walls & Ceiling Color", location: "Interior Walls & Ceilings", choiceCount: 0, ordering: "Auto", locked: true },
    ]
  )
  assert.equal(template.selections.every(
    (selection) =>
      selection.category === "09 91 23 - Interior Painting" &&
      selection.status === "Unreleased" &&
      selection.allowance === 0 &&
      selection.deadline === null &&
      selection.requireClientSelection === false &&
      selection.allowMultipleSelectedChoices === false &&
      selection.visibility === "Viewing / Price Requests Only" &&
      selection.installerCount === 4 &&
      selection.subVendorCount === 5
  ), true)

  const quantity = template.selections.find(
    (selection) => selection.sourceSelectionId === "58363712"
  )
  assert.ok(quantity)
  assert.deepEqual(
    quantity.choices.map((choice) => ({
      id: choice.sourceChoiceId,
      title: choice.title,
      attachmentCount: choice.attachmentCount,
      dependentSelectionCount: choice.dependentSelectionCount,
    })),
    [
      { id: "234167396", title: "One-Color", attachmentCount: 1, dependentSelectionCount: 1 },
      { id: "234167432", title: "Two-Color", attachmentCount: 1, dependentSelectionCount: 2 },
      { id: "234167997", title: "Three-Color", attachmentCount: 1, dependentSelectionCount: 3 },
      { id: "234168039", title: "More Than Three-Colors", attachmentCount: 0, dependentSelectionCount: 1 },
    ]
  )
  assert.equal(quantity.choices.every(
    (choice) => choice.status === "Unreleased" && choice.price === 0
  ), true)
  assert.equal(quantity.choices[0].attachments[0].fileName, "Interior Painting One-Color.png")
  assert.match(quantity.choices[0].description, /One color to be used throughout the home/)
  assert.match(quantity.choices[1].description, /second color for paint-grade interior doors and trim/)
  assert.match(quantity.choices[2].description, /third color for paint-grade interior doors and trim/)
  assert.match(quantity.choices[3].description, /more than three colors throughout the home/)

  const meeting = template.selections.find(
    (selection) => selection.sourceSelectionId === "58364611"
  )
  assert.ok(meeting)
  assert.deepEqual(meeting.choices, [{
    sourceChoiceId: "234169811",
    title: "Schedule a Meeting for More than Three-Colors",
    status: "Unreleased",
    price: 0,
    description: "",
    attachmentCount: 0,
    dependentSelectionCount: 0,
  }])

  assert.equal(fragment.conversionExceptions.length, 1)
  assert.equal(fragment.conversionExceptions[0].field, "choices.attachments.fileName")
  assert.match(fragment.conversionExceptions[0].loss, /Two-Color and Three-Color attachment filenames/)
  assert.match(fragment.conversionExceptions[0].recoveryPlan, /do not infer filenames/)
})

test("preserves the Interior Painting bid package and releases only a guarded draft", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])
  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  const painting = result.capture.templates.find(
    (template) => template.sourceTemplateId === interiorPaintingTemplateId
  )
  assert.ok(painting)
  assert.equal(painting.tasks.length, 0)
  assert.equal("scheduleItems" in painting, false)
  assert.equal(painting.selections.length, 8)
  assert.equal(painting.bidPackages.length, 1)

  const bid = painting.bidPackages[0]
  assert.deepEqual({
    id: bid.sourceBidPackageId,
    title: bid.title,
    status: bid.status,
    multiple: bid.allowMultipleApprovedBids,
    deadline: bid.deadline,
    time: bid.time,
    linkToSchedule: bid.linkToSchedule,
    reminderLeadDays: bid.reminderLeadDays,
    plansAndSpecs: bid.plansAndSpecs,
    pricingFormat: bid.pricingFormat,
    internalNotes: bid.internalNotes,
    attachments: bid.attachments,
  }, {
    id: "10431886",
    title: "Int. Paint/Stain - (Project Add.) (Estimate Phase)",
    status: "Draft",
    multiple: false,
    deadline: null,
    time: null,
    linkToSchedule: false,
    reminderLeadDays: 2,
    plansAndSpecs: false,
    pricingFormat: "Line Items",
    internalNotes: "",
    attachments: [],
  })
  assert.deepEqual(
    bid.lineItems.map((line) => ({
      title: line.title,
      costCode: line.costCode,
      costType: line.costType,
      quantity: line.quantity,
      unit: line.unit,
    })),
    [
      { title: "Covering & Masking Labor & Materials", costCode: "01 76 00 - Protecting Installed", costType: "Subcontractor", quantity: 1, unit: null },
      { title: "Interior Painting Labor & Materials", costCode: "09 91 23 - Interior Painting", costType: "Subcontractor", quantity: 1, unit: null },
      { title: "Interior Staining Labor & Materials", costCode: "09 93 23 - Int. Stain & Finish", costType: "Subcontractor", quantity: 1, unit: null },
    ]
  )
  assert.match(bid.lineItems[0].description, /prevent overspray\/stain/)
  assert.match(bid.lineItems[1].description, /painting interior non-stained members/)
  assert.match(bid.lineItems[2].description, /stain and finish interior stained members/)
  assert.match(bid.description, /Please direct any questions into the RFI section here on Buildertrend/)

  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
  assert.equal(result.capture.assembly.templateCount, 20)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 14)
})
