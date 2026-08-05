import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { readPilotContentFragments } from "./lib/buildertrend-template-content-pilot.mjs"
import { assembleBuildertrendTemplateNextBatchContent } from "./lib/buildertrend-template-next-batch-content.mjs"

const interiorDoorsTemplateId = "28466146"
const paths = {
  fragment: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/27-28466146.capture.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

const doorStyleTitles = [
  "\"Avalon Textured\"",
  "\"Birkdale Smooth\"",
  "\"Caiman Smooth\"",
  "\"Cambridge Smooth\"",
  "\"Camden Textured\"",
  "\"Cashal Smooth\"",
  "\"Colonist\"",
  "\"Conmore Smooth\"",
  "\"Continental Smooth\"",
  "\"Corvado Smooth\"",
  "\"Coventry Smooth\"",
  "\"Craftsman III Smooth\"",
  "\"Madison Smooth\"",
  "\"Monroe Smooth\"",
  "\"Princeton Smooth\"",
  "\"Rockport Smooth\"",
  "\"Santa Fe Smooth\"",
]

test("preserves exact Interior Doors task and selection evidence", async () => {
  const fragment = await readJson(paths.fragment)
  const { template } = fragment

  assert.equal(template.sourceTemplateId, interiorDoorsTemplateId)
  assert.equal(template.sourceName, "Int. Finishes - Interior Doors")
  assert.deepEqual(
    template.tasks.map((task) => ({
      sourceItemId: task.sourceItemId,
      parentSourceItemId: task.parentSourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75738494", parentSourceItemId: null, title: "RFQ Updated Interior Door Package", sortOrder: 1 },
      { sourceItemId: "75738495", parentSourceItemId: null, title: "Order Interior Door Package", sortOrder: 2 },
      { sourceItemId: "75738497", parentSourceItemId: null, title: "Store Interior Doors in Storage Container or House", sortOrder: 3 },
      { sourceItemId: "75738499", parentSourceItemId: null, title: "Interior Doors Installed", sortOrder: 4 },
      { sourceItemId: "75738500", parentSourceItemId: null, title: "Verify Door Style & Finishes with Owner", sortOrder: 5 },
    ]
  )

  assert.deepEqual(
    template.selections.map((selection) => ({
      sourceSelectionId: selection.sourceSelectionId,
      title: selection.title,
      choiceCount: selection.choices.length,
    })),
    [
      { sourceSelectionId: "42314323", title: "Interior Door Style", choiceCount: 17 },
      { sourceSelectionId: "41215280", title: "Interior Door Style", choiceCount: 17 },
      { sourceSelectionId: "41215891", title: "Interior Door Wood Species for Stain Grade Doors", choiceCount: 5 },
      { sourceSelectionId: "42314324", title: "Interior Doors Paint or Stain Grade", choiceCount: 2 },
    ]
  )
  assert.equal(template.selections.every((selection) => selection.category === "08 00 00 - Openings"), true)
  assert.equal(template.selections.every((selection) => selection.location === "Interior"), true)
  assert.equal(template.selections.every((selection) => selection.status === "Unreleased"), true)
  assert.equal(template.selections.every((selection) => selection.allowance === 0), true)
  assert.equal(template.selections.every((selection) => selection.deadline === null), true)
  assert.equal(template.selections.every((selection) => selection.requireClientSelection === false), true)
  assert.equal(template.selections.every((selection) => selection.allowMultipleSelectedChoices === false), true)
  assert.equal(template.selections.every((selection) => selection.choiceOrdering === "Auto"), true)

  assert.deepEqual(template.selections[0].choices.map((choice) => choice.sourceChoiceId), [
    "160297157", "160297158", "160297159", "160297160", "160297161", "160297162",
    "160297163", "160297164", "160297165", "160297166", "160297167", "160297168",
    "160297169", "160297170", "160297171", "160297172", "160297173",
  ])
  assert.deepEqual(template.selections[0].choices.map((choice) => choice.title), doorStyleTitles)
  assert.deepEqual(template.selections[1].choices.map((choice) => choice.sourceChoiceId), [
    "156171929", "156171934", "156171938", "156171944", "156171950", "156171970",
    "156171972", "156171993", "156171998", "156172002", "156172317", "156172322",
    "156172323", "156172328", "156172333", "156172335", "156172341",
  ])
  assert.deepEqual(template.selections[1].choices.map((choice) => choice.title), doorStyleTitles)
  assert.deepEqual(
    template.selections[2].choices.map((choice) => [choice.sourceChoiceId, choice.title]),
    [
      ["156174601", "Birchwood"],
      ["156174603", "Clear Alder"],
      ["156174857", "Clear Pine"],
      ["156174860", "Knotty Alder"],
      ["156174862", "Knotty Pine"],
    ]
  )
  assert.deepEqual(
    template.selections[3].choices.map((choice) => [choice.sourceChoiceId, choice.title]),
    [["160297174", "Paint Grade"], ["160297175", "Stain Grade"]]
  )

  const choices = template.selections.flatMap((selection) => selection.choices)
  assert.equal(choices.length, 41)
  assert.equal(new Set(choices.map((choice) => choice.sourceChoiceId)).size, 41)
  assert.equal(choices.every((choice) => choice.status === "Unreleased"), true)
  assert.equal(choices.every((choice) => choice.price === 0), true)
  assert.equal(choices.every((choice) => choice.attachmentCount === 1), true)
  assert.equal(choices.every((choice) => "description" in choice === false), true)
  assert.equal(choices.every((choice) => "attachments" in choice === false), true)

  assert.deepEqual(fragment.conversionExceptions.map((exception) => exception.field), [
    "choices.description",
    "choices.attachments.fileName",
  ])
  assert.equal(fragment.conversionExceptions.every((exception) => exception.templateSourceTemplateId === interiorDoorsTemplateId), true)
  assert.equal(fragment.conversionExceptions.every((exception) => /do not/.test(exception.recoveryPlan)), true)
})

test("releases Interior Doors with canonical reviewed schedule truth and fail-closed exceptions", async () => {
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
  const interiorDoors = result.capture.templates.find(
    (template) => template.sourceTemplateId === interiorDoorsTemplateId
  )
  assert.ok(interiorDoors)
  assert.equal(interiorDoors.tasks.length, 5)
  assert.equal(interiorDoors.selections.length, 4)
  assert.equal(interiorDoors.bidPackages.length, 0)
  assert.deepEqual(
    interiorDoors.scheduleItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      { sourceItemId: "166641616", title: "Interior Door Delivery", startDate: "2023-03-08", workdays: 1, phase: "UNASSIGNED", displayColor: "#DDC817" },
      { sourceItemId: "166641633", title: "Interior Door Installation", startDate: "2023-03-09", workdays: 2, phase: "UNASSIGNED", displayColor: "#008000" },
      { sourceItemId: "180251529", title: "HPS Interior Door QC Inspection", startDate: "2023-03-13", workdays: 1, phase: "Interior Finish", displayColor: "#2222DD" },
    ]
  )
  assert.deepEqual(
    interiorDoors.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      { predecessorSourceItemId: "166641616", successorSourceItemId: "166641633", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "166641633", successorSourceItemId: "180251529", type: "FS", lagDays: 0 },
    ]
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
})
