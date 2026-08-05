import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const stainConcreteTemplateId = "12979213"
const paths = {
  fragment: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/28-12979213.capture.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

async function assemble() {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])
  return assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
}

test("preserves the exact Stain & Seal Concrete Floors task identities and root ordering", async () => {
  const fragment = await readJson(paths.fragment)

  assert.equal(fragment.sourceTemplateId, stainConcreteTemplateId)
  assert.deepEqual(
    fragment.tasks.map((task) => ({
      sourceItemId: task.sourceItemId,
      parentSourceItemId: task.parentSourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75719048", parentSourceItemId: null, title: "1st Mop", sortOrder: 1 },
      { sourceItemId: "75719049", parentSourceItemId: null, title: "2nd Mop", sortOrder: 2 },
      { sourceItemId: "75719050", parentSourceItemId: null, title: "Floors Cleaned and Ready for Stain", sortOrder: 3 },
      { sourceItemId: "75719051", parentSourceItemId: null, title: "Stain Concrete Floors", sortOrder: 4 },
      { sourceItemId: "75719052", parentSourceItemId: null, title: "Seal 1st Coat", sortOrder: 5 },
      { sourceItemId: "75719053", parentSourceItemId: null, title: "Seal 2nd Coat", sortOrder: 6 },
      { sourceItemId: "75719054", parentSourceItemId: null, title: "Floors Covered with Ramboard", sortOrder: 7 },
    ]
  )
  assert.equal(new Set(fragment.tasks.map((task) => task.sourceItemId)).size, 7)
  assert.equal(fragment.tasks.every((task) => task.parentSourceItemId === null), true)
  assert.deepEqual(fragment.selections, [])
  assert.deepEqual(fragment.bidPackages, [])
})

test("assembles Stain & Seal Concrete Floors with the canonical reviewed schedule graph", async () => {
  const result = await assemble()
  const template = result.capture.templates.find(
    (candidate) => candidate.sourceTemplateId === stainConcreteTemplateId
  )

  assert.ok(template)
  assert.equal(template.tasks.length, 7)
  assert.equal(template.scheduleItems.length, 5)
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
      { sourceItemId: "145114223", title: "Prep Floors", startDate: "2022-05-23", workdays: 1, phase: "Interior Finish", displayColor: "#008000" },
      { sourceItemId: "145114248", title: "Stain Floors", startDate: "2022-05-24", workdays: 1, phase: "Interior Finish", displayColor: "#008000" },
      { sourceItemId: "145114252", title: "Seal Floors", startDate: "2022-05-25", workdays: 3, phase: "Interior Finish", displayColor: "#008000" },
      { sourceItemId: "145114287", title: "HPS Concrete Stain & Seal QC Inspection", startDate: "2022-05-30", workdays: 1, phase: "Interior Finish", displayColor: "#2222DD" },
      { sourceItemId: "145114260", title: "Cover Floors", startDate: "2022-05-31", workdays: 1, phase: "Interior Finish", displayColor: "#008000" },
    ]
  )
  assert.deepEqual(
    template.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      { predecessorSourceItemId: "145114223", successorSourceItemId: "145114248", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "145114248", successorSourceItemId: "145114252", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "145114252", successorSourceItemId: "145114287", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "145114252", successorSourceItemId: "145114260", type: "FS", lagDays: 1 },
    ]
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
})
