import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { assembleBuildertrendTemplateNextBatchContent } from "./lib/buildertrend-template-next-batch-content.mjs"

const sourceTemplateId = "12650484"
const paths = {
  fragment: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/24-12650484.capture.json",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

async function assembled() {
  const [release, nextBatchManifest, reviewedCapture] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
  ])
  const documents = await Promise.all(release.templates.map(async (template) => ({
    source: template.fragmentPath,
    document: await readJson(template.fragmentPath),
  })))
  return assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
}

test("preserves the Exterior Man Door checklist hierarchy and order", async () => {
  const result = await assembled()
  const template = result.capture.templates.find((item) => item.sourceTemplateId === sourceTemplateId)
  assert.ok(template)
  assert.equal(template.tasks.length, 11)
  assert.deepEqual(
    template.tasks.filter((task) => task.parentSourceItemId === null).map((task) => ({
      sourceItemId: task.sourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75709576", title: "Install (X) Level (Direction) Wall Man Door", sortOrder: 1 },
      { sourceItemId: "75709577", title: "HPS (X) Level Exterior Man Door QC Inspection", sortOrder: 2 },
    ]
  )
  assert.deepEqual(
    template.tasks.filter((task) => task.parentSourceItemId === "75709577").map((task) => task.title),
    [
      "All Doors Installed Properly",
      "All Screws & Nails Recessed for Caulking",
      "All Doors Open/Close Properly",
      "All Doors Level",
      "All Doors Plumb",
      "All Doors Foamed/Insulated Around Edges (If Necessary)",
      "No Damage on Any Doors",
      "Jobsite Cleanup Satisfactory",
      "OK to Pay",
    ]
  )
})

test("preserves the Exterior Man Door selection and bid specifications", async () => {
  const result = await assembled()
  const template = result.capture.templates.find((item) => item.sourceTemplateId === sourceTemplateId)
  assert.ok(template)

  assert.equal(template.selections.length, 1)
  assert.deepEqual(template.selections[0], {
    sourceItemId: "44854674",
    sourceSelectionId: "44854674",
    title: "Exterior Man Doors",
    category: "08 11 00 - Exterior Doors",
    location: "Unassigned",
    status: "Unreleased",
    allowance: 0,
    deadline: null,
    description: "Please input as a selection the door you would like to use, if you need a place to start, please visit https://www.thermatru.com/ for potential door options.",
    internalNotes: "",
    requireClientSelection: false,
    allowMultipleSelectedChoices: false,
    choiceOrdering: "Auto",
    choices: [],
  })

  assert.equal(template.bidPackages.length, 1)
  const bidPackage = template.bidPackages[0]
  assert.equal(bidPackage.sourceBidPackageId, "9601770")
  assert.equal(bidPackage.title, "Ext Doors - (Project Address) (Est. Phase)")
  assert.equal(bidPackage.status, "Draft")
  assert.equal(bidPackage.pricingFormat, "Line Items")
  assert.equal(bidPackage.plansAndSpecs, false)
  assert.match(bidPackage.description, /Construction Documents/)
  assert.match(bidPackage.description, /Contract and Insurance Requirements/)
  assert.deepEqual(bidPackage.lineItems, [
    {
      sourceLineItemId: "16491556",
      title: "Sliding Glass Doors",
      costCode: "08 32 00 - Sliding Glass Doors",
      costType: "Material",
      quantity: 1,
      unit: null,
      description: "",
    },
    {
      sourceLineItemId: "16491557",
      title: "Entry Man Doors",
      costCode: "08 00 00 - Openings",
      costType: "Material",
      quantity: null,
      unit: null,
      description: "Please Spec, Therma-Tru Door or Equivalent.",
    },
  ])
})

test("uses the canonical reviewed Exterior Man Door schedule", async () => {
  const result = await assembled()
  const template = result.capture.templates.find((item) => item.sourceTemplateId === sourceTemplateId)
  assert.ok(template)
  assert.deepEqual(
    template.scheduleItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "141692419",
        title: "Install (X) Level Exterior Man Doors",
        startDate: "2022-04-13",
        workdays: 2,
        phase: "Rough: Frame",
        displayColor: "#ABBE91",
      },
      {
        sourceItemId: "141692914",
        title: "HPS (X) Level Exterior Man Door QC Inspection",
        startDate: "2022-04-15",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#2222DD",
      },
    ]
  )
  assert.deepEqual(template.scheduleItems.flatMap((item) => item.predecessors), [
    {
      predecessorSourceItemId: "141692419",
      successorSourceItemId: "141692914",
      type: "FS",
      lagDays: 0,
    },
  ])
  assert.deepEqual(
    result.capture.conversionExceptions.filter((exception) => exception.templateSourceTemplateId === sourceTemplateId),
    []
  )
})
