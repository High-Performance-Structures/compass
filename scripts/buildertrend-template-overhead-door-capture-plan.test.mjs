import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const templateId = "30919251"
const paths = {
  fragment: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/23-30919251.capture.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the reviewed Overhead Door checklist, selection, and bid package", async () => {
  const fragment = await readJson(paths.fragment)

  assert.equal(fragment.sourceTemplateId, templateId)
  assert.equal(fragment.sourceName, "Framing - Overhead Door Installation")
  assert.equal(fragment.tasks.length, 13)
  assert.deepEqual(fragment.tasks[0], {
    sourceItemId: "75811777",
    parentSourceItemId: null,
    title: "HPS Overhead Door QC Inspection",
    sortOrder: 1,
  })
  assert.deepEqual(
    fragment.tasks.slice(1).map((task) => [task.sourceItemId, task.title, task.sortOrder]),
    [
      ["75811895", "Weather Stripping Installed Properly", 1],
      ["75811896", "Doors Open, Close & Lock Properly", 2],
      ["75811897", "No Dents", 3],
      ["75811898", "No Damage", 4],
      ["75811899", "Bottom Fits tight to the floor", 5],
      ["75811900", "Does not allow snow/water entry", 6],
      ["75811913", "Fits tightly @ top & sides", 7],
      ["75811915", "No Sag", 8],
      ["75811916", "No Splits in Door Panel(s)", 9],
      ["75811918", "Windows in good condition", 10],
      ["75811920", "Jobsite Cleanup Satisfactory", 11],
      ["75811922", "OK to Pay", 12],
    ]
  )
  assert.equal(fragment.tasks.slice(1).every((task) => task.parentSourceItemId === "75811777"), true)

  assert.deepEqual(fragment.selections, [
    {
      sourceItemId: "44753269",
      sourceSelectionId: "44753269",
      title: "Garage Door",
      category: "08 33 23 - Overhead Coiling Door",
      location: "Exterior",
      status: "Unreleased",
      allowance: 0,
      deadline: null,
      description: "Please Visit https://www.haascreate.com/create/17087 to create your garage door and upload your selection for us to estimate!",
      internalNotes: "",
      requireClientSelection: false,
      allowMultipleSelectedChoices: false,
      choiceOrdering: "Auto",
      choices: [],
    },
  ])

  assert.equal(fragment.bidPackages.length, 1)
  assert.equal(fragment.bidPackages[0].sourceBidPackageId, "9601774")
  assert.equal(fragment.bidPackages[0].linkedPlanCount, 0)
  assert.equal(fragment.bidPackages[0].linkedSpecCount, 0)
  assert.deepEqual(
    fragment.bidPackages[0].lineItems.map((item) => ({
      sourceLineItemId: item.sourceLineItemId,
      title: item.title,
      costCode: item.costCode,
      costType: item.costType,
      quantity: item.quantity,
      unit: item.unit,
      description: item.description ?? "",
    })),
    [
      {
        sourceLineItemId: "16491568",
        title: "Garage Door Installation Labor & Materials",
        costCode: "08 36 00 - Panel Doors",
        costType: "Labor, Material, Subcontractor",
        quantity: 1,
        unit: null,
        description: "Please Spec (Garage Door Type). (Low Head Room Track?)",
      },
      {
        sourceLineItemId: "16491569",
        title: "Garage Door Opener Labor & Materials",
        costCode: "08 36 00 - Panel Doors",
        costType: "Labor, Material, Subcontractor",
        quantity: 1,
        unit: null,
        description: "",
      },
    ]
  )
})

test("assembles Overhead Door as draft-only content and preserves schedule truth", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(documents.some(({ source }) => source.includes("incomplete-reviews")), false)
  assert.equal(release.templates.some((template) => template.sourceTemplateId === templateId), true)

  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  const assembled = result.capture.templates.find((template) => template.sourceTemplateId === templateId)
  assert.ok(assembled)
  assert.equal(assembled.tasks.length, 13)
  assert.equal(assembled.selections.length, 1)
  assert.equal(assembled.bidPackages.length, 1)
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)

  const reviewedTemplate = reviewedCapture.templates.find(
    (template) => template.sourceTemplateId === templateId
  )
  assert.ok(reviewedTemplate)
  assert.deepEqual(
    reviewedTemplate.schedule.items.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "180251869",
        title: "Overhead Door Installation",
        startDate: "2023-08-23",
        workdays: 2,
        phase: "Rough: Frame",
        displayColor: "#E39D6C",
      },
      {
        sourceItemId: "180251891",
        title: "HPS Overhead Door QC Inspection",
        startDate: "2023-08-25",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#2222DD",
      },
    ]
  )
  assert.deepEqual(reviewedTemplate.schedule.dependencies, [
    {
      predecessorSourceItemId: "180251869",
      successorSourceItemId: "180251891",
      type: "FS",
      lagDays: 0,
    },
  ])
})
